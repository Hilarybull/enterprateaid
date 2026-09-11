-- Remove AI icons, symbol bullets, and em dashes from all article content.
-- Safe to run multiple times.

-- A column can only be assigned once per UPDATE in Postgres, so the chain of
-- replace() calls is nested into a single assignment (was previously written
-- as repeated "content = ..." clauses, which is invalid SQL and always failed
-- with "multiple assignments to same column").
UPDATE blog_articles
SET content = replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(content, '✨ ', ''),
                    '✨', ''
                  ),
                  '<span style="color:#6366f1;flex-shrink:0">⊙</span>', ''
                ),
                '<span style="color:#6366f1;flex-shrink:0">⊙</span> ', ''
              ),
              '⊙ ', ''
            ),
            '⊙', ''
          ),
          'display:flex;align-items:flex-start;gap:10px;color:#334155',
          'color:#334155;padding-left:4px'
        ),
        ' — ', ' - '
      ),
      '—', '-'
    )
WHERE content IS NOT NULL
  AND (
    content LIKE '%✨%'
    OR content LIKE '%⊙%'
    OR content LIKE '%—%'
    OR content LIKE '%display:flex;align-items:flex-start;gap:10px%'
  );
