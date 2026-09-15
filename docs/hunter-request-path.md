# Hunter request compatibility

ArborLine authenticates Hunter API calls server-side with the documented `X-API-KEY` header. Email Finder uses `first_name` + `last_name` for simple two-part names and falls back to `full_name` for other names.

A Hunter 429 accompanied by a positive account credit balance is treated as a Finder/API-key restriction rather than an exhausted shared credit pool.
