-- Unique view count for proposal requests, visible to the request's owner only.
-- "Unique" = unique viewer_key: the logged-in user's id, or an anonymous id the
-- frontend generates once and stores in localStorage. Repeat visits from the
-- same signed-in account or the same browser don't inflate the count; visiting
-- from a different browser/device (or after clearing storage) does count again
-- — that's the honest limit of tracking anonymous visitors without requiring
-- login. Safe to run multiple times.

ALTER TABLE proposal_requests
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS proposal_request_views (
    request_id       UUID NOT NULL REFERENCES proposal_requests(id) ON DELETE CASCADE,
    viewer_key       TEXT NOT NULL,  -- "user:<user_id>" or "anon:<client-generated id>"
    first_viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (request_id, viewer_key)
);

-- Records a view and returns the up-to-date unique count. Only increments
-- proposal_requests.view_count the first time this viewer_key is seen for
-- this request — the PRIMARY KEY makes the dedup itself race-safe (a second
-- concurrent insert for the same (request_id, viewer_key) just no-ops).
CREATE OR REPLACE FUNCTION record_proposal_request_view(p_request_id UUID, p_viewer_key TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INTEGER;
  new_count INTEGER;
BEGIN
  INSERT INTO proposal_request_views (request_id, viewer_key)
  VALUES (p_request_id, p_viewer_key)
  ON CONFLICT (request_id, viewer_key) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows > 0 THEN
    UPDATE proposal_requests
    SET view_count = view_count + 1
    WHERE id = p_request_id
    RETURNING view_count INTO new_count;
  ELSE
    SELECT view_count INTO new_count FROM proposal_requests WHERE id = p_request_id;
  END IF;

  RETURN new_count;
END;
$$;

-- Superseded by record_proposal_request_view above (kept only so a database
-- that already has it from a prior run doesn't error; no longer called).
DROP FUNCTION IF EXISTS increment_proposal_request_view_count(UUID);
