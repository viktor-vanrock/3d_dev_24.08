-- migrate:up

ALTER TABLE device_print_results
  ADD COLUMN IF NOT EXISTS print_request_id UUID
    REFERENCES device_print_requests(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_print_results_request_id
  ON device_print_results (print_request_id)
  WHERE print_request_id IS NOT NULL;

ALTER TABLE device_print_requests
  DROP CONSTRAINT IF EXISTS device_print_requests_status_check;

ALTER TABLE device_print_requests
  ADD CONSTRAINT device_print_requests_status_check
  CHECK (status = ANY (ARRAY['slice_ready', 'delivered', 'awaiting_confirmation', 'accepted', 'printing', 'completed', 'failed', 'rejected']));

-- migrate:down

ALTER TABLE device_print_requests
  DROP CONSTRAINT IF EXISTS device_print_requests_status_check;

ALTER TABLE device_print_requests
  ADD CONSTRAINT device_print_requests_status_check
  CHECK (status = ANY (ARRAY['slice_ready', 'delivered', 'awaiting_confirmation', 'accepted', 'printing', 'failed', 'rejected']));

DROP INDEX IF EXISTS idx_print_results_request_id;

ALTER TABLE device_print_results
  DROP COLUMN IF EXISTS print_request_id;
