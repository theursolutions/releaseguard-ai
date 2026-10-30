# ARCHITECTURE AND OOP

Follow the existing architecture before introducing new architecture.

## PRINCIPLES

Use:

* SOLID
* DRY
* KISS
* YAGNI
* separation of concerns
* dependency inversion
* composition over unnecessary inheritance

## RESPONSIBILITIES

Controllers:

* request coordination
* authorization coordination
* response generation

Services:

* business operations

Repositories:

* use only where they provide meaningful abstraction

Models:

* persistence and domain behavior appropriate to the project's architecture

Jobs:

* asynchronous work

Events:

* decoupled notifications/integration triggers

Policies:

* authorization rules

Requests:

* request validation

## AVOID

* God classes
* God methods
* duplicated business logic
* unnecessary abstraction
* unnecessary repositories
* unnecessary interfaces
* business logic in views
* business logic in routes
* huge controllers

Do not refactor existing architecture unless required by the approved feature.
