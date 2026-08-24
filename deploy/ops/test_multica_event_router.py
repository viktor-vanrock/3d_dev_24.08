import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).with_name("multica-event-router.py")


def load_router():
    psycopg2 = types.ModuleType("psycopg2")
    psycopg2.connect = lambda *_args, **_kwargs: None
    extensions = types.ModuleType("psycopg2.extensions")
    extensions.ISOLATION_LEVEL_AUTOCOMMIT = 0
    with patch.dict(sys.modules, {"psycopg2": psycopg2,
                                  "psycopg2.extensions": extensions}):
        spec = importlib.util.spec_from_file_location("event_router", ROOT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


class BatchDeliveryTest(unittest.TestCase):
    def test_failed_delivery_keeps_batch_for_retry(self):
        router = load_router()
        items = [{"issue_id": str(n)} for n in range(5)]
        sent = []

        def fire(endpoint, *_args):
            sent.append(endpoint)
            return False

        with patch.object(router, "state_get", return_value=items), \
             patch.object(router, "state_set") as state_set, \
             patch.object(router, "fire", side_effect=fire):
            router.batch("docs_gate", items[-1], 5, ["docs_lineage"],
                         "docs_lineage_batch")

        state_set.assert_not_called()
        self.assertEqual(sent, ["docs_lineage"])

    def test_successful_delivery_clears_batch(self):
        router = load_router()
        items = [{"issue_id": str(n)} for n in range(5)]
        with patch.object(router, "state_get", return_value=items), \
             patch.object(router, "state_set") as state_set, \
             patch.object(router, "fire", return_value=True):
            router.batch("docs_gate", items[-1], 5, ["docs_lineage"],
                         "docs_lineage_batch")

        state_set.assert_called_once_with("docs_gate", [])

    def test_retry_of_failed_delivery_clears_same_batch_after_success(self):
        router = load_router()
        items = [{"issue_id": str(n)} for n in range(5)]
        outcomes = iter((False, True))
        with patch.object(router, "state_get", return_value=items), \
             patch.object(router, "state_set") as state_set, \
             patch.object(router, "fire", side_effect=lambda *_args: next(outcomes)) as fire:
            router.batch("docs_gate", items[-1], 5, ["docs_lineage"],
                         "docs_lineage_batch")
            router.batch("docs_gate", items[-1], 5, ["docs_lineage"],
                         "docs_lineage_batch")

        self.assertEqual(fire.call_count, 2)
        state_set.assert_called_once_with("docs_gate", [])


class RecoveryAdmissionTest(unittest.TestCase):
    def test_queued_expiry_is_persisted_in_recovery_queue(self):
        router = load_router()
        payload = {
            "task_id": "task-1",
            "issue_id": "issue-1",
            "status": "failed",
            "failure_reason": "queued_expired",
        }
        cfg = {"project_id": "project-1"}
        with patch.object(router, "load", return_value=cfg), \
             patch.object(router, "enqueue_recovery") as enqueue, \
             patch.object(router, "dispatch_recovery", return_value=0) as dispatch, \
             patch.object(router, "active_task_count", return_value=2), \
             patch.object(router, "recovery_waiting_count", return_value=1), \
             patch.object(router, "state_get", return_value=2), \
             patch.object(router, "state_set"), \
             patch.object(router, "dispatch_delivery_gate"):
            router.route("task_terminal", payload)

        enqueue.assert_called_once_with(payload)
        dispatch.assert_called_once()

    def test_webhook_waits_in_outbox_while_agent_capacity_is_full(self):
        router = load_router()
        cfg = {"endpoints": {"agentops": {"url": "https://example.invalid"}}}
        with patch.object(router, "load", return_value=cfg), \
             patch.object(router, "active_task_count", return_value=2), \
             patch.object(router, "query") as query, \
             patch.object(router.urllib.request, "urlopen") as urlopen:
            self.assertFalse(router.fire("agentops", "event", {}, "fp"))

        query.assert_not_called()
        urlopen.assert_not_called()

    def test_endpoint_cooldown_prevents_429_storm(self):
        router = load_router()
        cfg = {"endpoints": {"agentops": {"url": "https://example.invalid"}}}
        with patch.object(router, "load", return_value=cfg), \
             patch.object(router, "active_task_count", return_value=0), \
             patch.object(router, "state_get", return_value={"until": router.time.time() + 120}), \
             patch.object(router, "query") as query, \
             patch.object(router.urllib.request, "urlopen") as urlopen:
            self.assertFalse(router.fire("agentops", "event", {}, "fp"))

        query.assert_not_called()
        urlopen.assert_not_called()

    def test_delivery_waits_for_free_capacity(self):
        router = load_router()
        pending = {"cards": [{"issue_id": "issue-1"}], "origin_sha": "abc"}
        with patch.object(router, "state_get", return_value=pending), \
             patch.object(router, "active_task_count", return_value=2), \
             patch.object(router, "fire") as fire:
            self.assertFalse(router.dispatch_delivery_gate())

        fire.assert_not_called()

    def test_terminal_issue_queue_is_cancelled_without_recovery(self):
        router = load_router()

        def query(sql, args=(), one=False):
            if "i.status in ('done','cancelled')" in sql:
                return [("task-done", "issue-done")]
            return []

        result = types.SimpleNamespace(returncode=0, stdout="{}", stderr="")
        with patch.object(router, "query", side_effect=query), \
             patch.object(router, "sh", return_value=result) as shell:
            self.assertEqual(router.cancel_terminal_issue_tasks(), 1)

        shell.assert_called_once_with(
            "/usr/local/bin/multica", "issue", "cancel-task", "task-done",
            "--issue", "issue-done", "--output", "json")

    def test_admission_defers_queue_overflow_via_public_cli(self):
        router = load_router()
        calls = []

        def query(sql, args=(), one=False):
            calls.append((sql, args))
            if "row_number()" in sql:
                return [("task-9", "issue-9")]
            if "select status from agent_task_queue" in sql:
                return ("cancelled",)
            return []

        result = types.SimpleNamespace(returncode=0, stdout="{}", stderr="")
        with patch.object(router, "query", side_effect=query), \
             patch.object(router, "sh", return_value=result) as shell:
            self.assertEqual(router.defer_excess_queue(), 1)

        shell.assert_called_once_with(
            "/usr/local/bin/multica", "issue", "cancel-task", "task-9",
            "--issue", "issue-9", "--output", "json")
        self.assertTrue(any("insert into multica_recovery_queue" in sql for sql, _ in calls))

    def test_delivery_gate_is_not_starved_by_recovery_backlog(self):
        router = load_router()
        pending = {"cards": [{"issue_id": "issue-1"}], "origin_sha": "abc"}
        with patch.object(router, "state_get", return_value=pending), \
             patch.object(router, "active_task_count", return_value=0), \
             patch.object(router, "fire", return_value=True) as fire, \
             patch.object(router, "state_set") as state_set:
            self.assertTrue(router.dispatch_delivery_gate())

        fire.assert_called_once()
        state_set.assert_called_once_with("delivery_pending", {"cards": []})


if __name__ == "__main__":
    unittest.main()
