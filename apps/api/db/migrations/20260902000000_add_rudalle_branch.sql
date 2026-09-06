-- migrate:up
ALTER TABLE generations DROP CONSTRAINT generations_branch_check;
ALTER TABLE generations ADD CONSTRAINT generations_branch_check
  CHECK (branch = ANY (ARRAY[
    'openscad'::text,
    'kzd'::text,
    'hueforge'::text,
    'trellis'::text,
    'concepts'::text,
    'scan'::text,
    'rudalle'::text
  ]));

-- migrate:down
ALTER TABLE generations DROP CONSTRAINT generations_branch_check;
ALTER TABLE generations ADD CONSTRAINT generations_branch_check
  CHECK (branch = ANY (ARRAY[
    'openscad'::text,
    'kzd'::text,
    'hueforge'::text,
    'trellis'::text,
    'concepts'::text,
    'scan'::text
  ]));
