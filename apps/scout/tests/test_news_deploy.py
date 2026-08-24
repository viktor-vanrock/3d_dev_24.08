from pathlib import Path

DEPLOY = Path(__file__).parents[1] / "deploy"


def test_pipeline_and_publisher_have_disjoint_credentials_and_hardened_home():
    pipeline = (DEPLOY / "portal.scout-news-pipeline.service").read_text()
    publisher = (DEPLOY / "portal.scout-news-publisher.service").read_text()

    assert "scout-news-publisher.env" not in pipeline
    assert "UnsetEnvironment=SCOUT_NEWS_FEED_INGEST_KEY" in pipeline
    assert "UnsetEnvironment=SCOUT_NEWS_FEED_INGEST_KEY AGENT_CONTENT_KEY XAI_API_KEY" in pipeline
    assert "EnvironmentFile=/etc/portal/scout-news-publisher.env" in publisher
    assert "LoadCredential=dev-readback-session:/home/plag/.autofab-session-dev" in publisher
    assert "ProtectHome=tmpfs" in publisher
    assert "BindReadOnlyPaths=/home/plag/portal.ru-dev/apps/scout" in publisher
    assert "DATABASE_URL" in publisher.split("UnsetEnvironment=", 1)[1].splitlines()[0]
    assert "ReadWritePaths=/var/lib/portal-scout-news /home/plag/.grok/sessions" in pipeline
    assert "/home/plag/.grok/sessions" not in publisher


def test_timer_is_versioned_but_deploy_runbook_keeps_it_disabled_until_review():
    timer = (DEPLOY / "portal.scout-news-pipeline.timer").read_text()
    runbook = (DEPLOY / "readme.md").read_text()

    assert "OnCalendar=" in timer
    assert "Persistent=false" in timer
    assert "disable --now portal.scout-news-pipeline.timer" in runbook
    assert "enable --now portal.scout-news-pipeline.timer" not in runbook
