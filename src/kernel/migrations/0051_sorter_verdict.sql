-- #187. The model and the prompt version travel with the verdict, on the call
-- and on the message. A filtered message has no call, so the message has to
-- carry them too. Neither column is personal text.

ALTER TABLE service_call
  ADD COLUMN IF NOT EXISTS sorter_model text,
  ADD COLUMN IF NOT EXISTS sorter_prompt text;

ALTER TABLE message
  ADD COLUMN IF NOT EXISTS sorter_model text,
  ADD COLUMN IF NOT EXISTS sorter_prompt text;
