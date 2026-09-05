-- Deliberate violation, slice 1.7. Reverted immediately: this exists to watch guard one fire
-- inside the required gate rather than to be told it would.
ALTER TABLE unit ADD COLUMN current_tenant uuid;
