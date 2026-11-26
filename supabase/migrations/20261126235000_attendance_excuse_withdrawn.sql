-- A member can take back an absence form that has not been reviewed yet, and
-- forms for a voided meeting are closed the same way. (New enum values must be
-- committed before they are used, so this is its own migration.)
alter type public.attendance_excuse_status add value if not exists 'withdrawn';
