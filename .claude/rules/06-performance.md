# PERFORMANCE STANDARD

Performance is a requirement, not an afterthought.

For every significant feature evaluate:

* database queries
* memory usage
* CPU usage
* network calls
* API latency
* caching opportunities
* asynchronous processing
* concurrency
* scalability

## DATABASE

Check for:

* N+1
* missing indexes
* repeated queries
* unnecessary queries
* unbounded queries

## APPLICATION

Avoid:

* unnecessary loops
* repeated expensive calculations
* duplicate API calls
* unnecessary serialization
* unnecessary database writes

## LARGE DATASETS

Consider:

* pagination
* chunking
* cursor pagination
* bulk operations
* queues

Do not introduce caching or premature optimization without a measurable reason.
