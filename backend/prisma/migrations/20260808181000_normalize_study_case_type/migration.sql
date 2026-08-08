UPDATE "cases"
SET "case_type" = 'Study Permit'
WHERE LOWER(REGEXP_REPLACE(BTRIM("case_type"), '\s+', ' ', 'g')) = 'study';
