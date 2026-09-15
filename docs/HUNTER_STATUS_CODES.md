# Hunter API status handling

ArborLine treats Hunter API response codes according to Hunter's current API documentation:

- `401`: API credential problem.
- `403`: request-rate limit / forbidden response. ArborLine treats this as temporary throttling for Email Finder.
- `429`: Hunter usage/credit limit reached. ArborLine does not retry automatically because another request cannot succeed until usage is available again.

The Hunter manual lookup screen remains staff-only and no Hunter request creates, approves, queues, or sends outreach.
