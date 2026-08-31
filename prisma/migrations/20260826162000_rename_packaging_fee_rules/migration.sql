BEGIN;

-- Published workbook rules keep their original reference names and semantics.
-- The authoritative fee names are assigned only to cloned rules in the
-- rule-centre release migration.  This compatibility marker stays in the
-- sequence because some development databases already recorded its checksum.

COMMIT;
