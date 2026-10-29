-- +goose Up
-- Lane 285 (B275, re-review N18): the starter status catch-up's resume
-- cursor. A pass cut by its deadline (or by the account page bound) keeps
-- the last account it finished and the newest capture its window paired;
-- the next pass walks the accounts after resume_after over the same
-- window, and only a walk that finishes moves done_through to
-- resume_through and clears both. Null is no pass owed a resume.
alter table app.notify_marks
  add column resume_after   uuid,
  add column resume_through timestamptz,
  add constraint notify_marks_resume_pair check ((resume_after is null) = (resume_through is null));

-- +goose Down
alter table app.notify_marks
  drop constraint notify_marks_resume_pair,
  drop column resume_through,
  drop column resume_after;
