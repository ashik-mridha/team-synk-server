/** Shapes a `.lean()` result like a document's toJSON: `id` instead of `_id`/`__v`. */
export function withId(doc) {
  if (!doc) return doc;
  const copy = { ...doc };
  delete copy._id;
  delete copy.__v;
  return { id: String(doc._id), ...copy };
}
