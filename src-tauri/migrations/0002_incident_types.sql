-- Incident type becomes a real column. Every pre-existing incident was created through the
-- patient-oriented intake, so records with no recorded service are EMS; recorded services are kept.
ALTER TABLE incidents ADD COLUMN incident_type TEXT;
UPDATE incidents SET incident_type = COALESCE(
  (SELECT f.value FROM incident_fields f WHERE f.incident_id = incidents.id AND f.field = 'service' AND f.state = 'answered' AND f.value IN ('EMS', 'PD', 'FD')),
  'EMS');
-- The service field has been moved into the column above; nothing else is removed from incident_fields.
DELETE FROM incident_fields WHERE field = 'service';
-- Caller-reported vs independently verified.
ALTER TABLE incident_fields ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
-- Status vocabulary: draft / active / closed.
UPDATE incidents SET status = 'active' WHERE status = 'open';
UPDATE incidents SET status = 'closed' WHERE status = 'completed';
-- Bundled demo workflows are no longer shipped. Ones that saved sessions still reference are kept
-- as ordinary workflows awaiting validation; unreferenced ones are removed.
UPDATE workflow_definitions
  SET builtin = 0,
      definition_json = json_set(json_remove(definition_json, '$.provenance.note'), '$.status', 'pending-validation', '$.provenance.origin', 'user-import')
  WHERE builtin = 1 AND id IN (SELECT workflow_id FROM workflow_sessions);
DELETE FROM workflow_definitions WHERE builtin = 1 AND id NOT IN (SELECT workflow_id FROM workflow_sessions);
CREATE INDEX idx_incidents_type ON incidents(incident_type)
