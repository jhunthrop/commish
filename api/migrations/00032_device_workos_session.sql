-- +goose Up
-- Lane 225 (B212): an app's sign-out ends the WorkOS session too. An
-- app's sign-in no longer makes a site session (no cookie a phone holds),
-- so the WorkOS session id its callback read rides on the pairing code
-- for its ten minutes and lands on the device the code pairs. Signing
-- the device out answers the WorkOS logout URL for it. A device paired
-- before this has none and signs out with no URL; the extension's device
-- never carries one. Revoking a device clears it.
--
-- The codes' check bounds the length only: the binary before this one
-- upserts an extension code over an app code without naming the column,
-- so the row keeps the app's id beside kind 'extension' for its ten
-- minutes, and a kind clause here would refuse the account page's code
-- while that binary still serves (deploy or rollback). Pairing never
-- carries an id onto an extension device, and the devices check below
-- keeps the kind clause: no binary writes that column but this one.
alter table app.device_pair_codes add column workos_session_id text
  check (workos_session_id is null or char_length(workos_session_id) between 1 and 200);
alter table app.devices add column workos_session_id text
  check (workos_session_id is null or (kind <> 'extension' and char_length(workos_session_id) between 1 and 200));

-- +goose Down
alter table app.devices drop column workos_session_id;
alter table app.device_pair_codes drop column workos_session_id;
