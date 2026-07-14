You are acting as a Senior/Staff Software Engineer, Mobile Application Architect, and AI Product Systems Engineer.

Your task is to design and build a production-quality React Native mobile application that combines personal tracking, passive data collection, daily-life management, and AI-powered personal insights into one simple and cohesive product.

## Core Product Vision

This is NOT simply an expense tracker, habit tracker, or calorie tracker.

The long-term vision is to build a personal daily intelligence system.

The application should understand as much about the user's day as reasonably possible, reduce manual data entry, organize daily activity, and eventually use an AI intelligence layer called Synthesia AI to provide personalized insights, summaries, suggestions, and observations.

The user should feel:

"The app understands my day without me constantly updating it."

The application should initially include:

* Expense Tracker
* Habit Tracker
* Calorie / Food Tracker
* Water Intake Tracker
* Daily reminders
* Daily, weekly, and monthly summaries
* Personal insights and trends

However, the architecture must be designed around a broader concept:

PERSONAL CONTEXT COLLECTION → NORMALIZATION → TIMELINE → SUMMARIZATION → AI INSIGHTS

The application should feel simple and lightweight to the user even if the underlying system is technically sophisticated.

Do NOT turn the application into a cluttered productivity dashboard.

## Primary Product Principle: Minimize Manual Input

A major product goal is to collect as much useful contextual data in the background as technically, legally, and ethically possible.

Manual entry should be the fallback, not always the primary interaction.

The system should continuously evaluate:

"Can this information be inferred, imported, detected, or suggested instead of asking the user to manually enter it?"

Examples may include:

* Device activity
* Steps
* Health data
* Workout activity
* Location context
* Movement patterns
* Time context
* Notification-derived events where platform policies permit
* Transaction information where explicitly authorized
* UPI/payment-related context where technically and legally permitted
* Calendar events
* Screen or app activity where platform APIs permit
* Sleep data
* Food patterns
* Repeated expenses
* Habit patterns
* Water patterns
* User routines
* Frequently visited places
* Time spent at common locations
* Daily movement
* Weather context
* Day of week
* Time of day
* Previous user behavior

IMPORTANT:

Do not assume React Native or the operating system can access all of this data.

Before implementing any passive data source:

1. Verify Android support.
2. Verify iOS support.
3. Identify the required native APIs.
4. Identify permissions.
5. Identify background execution restrictions.
6. Identify App Store / Play Store policy implications.
7. Identify privacy implications.
8. Explain whether collection is reliable or best-effort.

Never create fake background collection.

Never imply that data is available if the operating system does not expose it.

## Privacy and Consent Are Architectural Requirements

The goal is to collect rich personal context, but this must be done transparently.

Never use dark patterns to obtain permissions.

Every sensitive data source must have:

* A clear user benefit
* Explicit permission where required
* A clear explanation of why the data is needed
* A way to disable the data source
* A way to view collected data where appropriate
* A deletion strategy
* Appropriate retention rules

Design a Data Sources or Connected Context screen.

The user should be able to understand:

* What data is being collected
* Where the data comes from
* When it was last synchronized
* What the application uses it for
* Whether Synthesia AI can use the data for insights
* How to disable the source

Examples:

Health Data — Connected
Location Context — Enabled
Calendar — Connected
Notifications — Not Enabled
Expense Import — Connected

Do not send sensitive user data to an AI provider without designing explicit consent and appropriate data handling.

Privacy should enable trust, not destroy the product experience.

## Personal Context Engine

Design a Personal Context Engine.

This should be treated as a core platform capability rather than being embedded inside individual trackers.

Its responsibility is to collect and normalize events from different sources.

Example raw sources:

* Manual expense entry
* Imported transaction
* Habit completion
* Food entry
* Health platform
* Water entry
* Calendar
* Location context
* Device activity
* Reminder interaction
* Background task
* External integration

Normalize useful activities into a common event model.

Conceptual example:

PersonalEvent

* id
* userId
* type
* source
* timestamp
* localDate
* timezone
* confidence
* metadata
* createdAt

Example event types:

expense.created
expense.detected
habit.completed
habit.missed
food.logged
water.logged
workout.detected
location.arrived
location.departed
calendar.started
calendar.completed
sleep.detected
movement.detected
reminder.completed

Do not force every database collection into this generic event model.

Domain collections should remain strongly modeled.

The PersonalEvent model should provide a normalized activity timeline for summaries and AI analysis.

Evaluate whether an event-driven architecture is justified.

Avoid unnecessary distributed systems for the MVP.

## Confidence-Based Data Inference

Not all automatically detected data should immediately become confirmed user data.

Design a confidence-based inference system.

Example:

A recurring ₹250 transaction at approximately 1 PM near a known restaurant may indicate lunch.

The system may create:

InferredContext:

* type: possible_meal
* confidence: 0.82
* supportingEvents: [...]
* status: pending

The UI could ask:

"Looks like you had lunch around 1:15 PM. Add it to today?"

The goal is:

Detect → Infer → Suggest → Confirm

NOT:

Detect → Silently Assume

High-confidence and low-risk events may eventually support configurable automation.

The architecture should support:

* confidence scores
* inference source
* supporting evidence
* user confirmation
* user rejection
* correction history

User corrections should improve future suggestions.

## Today Timeline

The core product experience should revolve around "Today".

The user should not feel like they are maintaining seven separate trackers.

The application should build a contextual timeline of the user's day.

Example:

7:30 AM
Woke up

8:05 AM
500 ml water

9:00 AM
Arrived at work

10:30 AM
Daily reading habit completed

1:15 PM
Possible lunch detected

2:04 PM
₹320 spent

5:40 PM
4,812 steps

7:15 PM
Workout detected

The Today experience should answer:

* What have I done today?
* What do I still need to do?
* What have I spent?
* What have I eaten?
* How much water have I consumed?
* Which habits are complete?
* What happened automatically?
* Is anything unusual?
* Is there anything worth noticing?

Prefer progressive disclosure.

Show simple information first.

Allow detailed information when the user intentionally opens a tracker.

## Synthesia AI Intelligence Layer

The application will eventually include Synthesia AI as a personal intelligence and insight layer.

Design the architecture so the AI system is NOT tightly coupled to the React Native client.

Synthesia AI should consume structured, normalized context rather than raw database dumps.

Conceptual pipeline:

Data Sources
↓
Domain Services
↓
Personal Context Engine
↓
Normalized Personal Events
↓
Daily Context Aggregator
↓
Summary Generation
↓
Synthesia AI
↓
Insights / Suggestions / Observations

The AI should eventually help users understand their behavior.

Examples:

"You usually spend 28% more on food on Fridays."

"You complete your reading habit more consistently before 10 AM."

"Your water intake has been lower than your usual pattern for three days."

"You tend to skip workouts on days with late meetings."

"Your spending this week is unusually high compared with your normal weekly pattern."

"You walked significantly less today than your typical Sunday."

"Your calorie intake tends to increase on low-activity days."

The AI should focus on useful observations.

Avoid generic motivational AI responses.

Bad:

"Great job! Keep going!"

Better:

"You completed this habit 6 of the last 7 times when it was scheduled before 9 AM. Consider moving the reminder from 7 PM to 8:30 AM."

Insights should ideally be:

* Evidence-based
* Context-aware
* Personalized
* Actionable
* Explainable

Where possible, the user should be able to understand WHY an insight was generated.

Example:

"Why am I seeing this?"

Based on:

* 18 expense events
* Last 4 Fridays
* Food category spending

## AI Data Preparation

Do not send the user's entire database directly to an LLM.

Design an AI Context Builder.

Its responsibility should be to:

* Select relevant context
* Aggregate numerical data
* Calculate deterministic metrics
* Detect trends
* Remove unnecessary fields
* Apply privacy rules
* Build structured AI context

Perform calculations in application services.

Do NOT ask an LLM to calculate basic totals or statistics that can be deterministically calculated in code.

Example AI context:

{
"period": "2026-07-01/2026-07-07",
"timezone": "Asia/Kolkata",
"expenses": {
"total": 4820,
"previousPeriod": 3610,
"categoryChanges": {
"food": 28
}
},
"habits": {
"reading": {
"completionRate": 0.86,
"mostSuccessfulTimeRange": "07:00-10:00"
}
},
"water": {
"averageMl": 1800,
"targetMl": 2500
}
}

Synthesia AI should interpret structured context and identify meaningful relationships.

## AI Insight Storage

Do not regenerate every AI insight every time the application opens.

Design an AIInsight model.

Consider fields such as:

* id
* userId
* type
* title
* description
* severity
* confidence
* supportingMetrics
* supportingEventIds
* periodStart
* periodEnd
* generatedAt
* expiresAt
* status
* userFeedback

Possible status values:

* active
* dismissed
* accepted
* expired

The user should eventually be able to indicate:

* Helpful
* Not helpful
* Incorrect

This feedback should be stored for future insight quality improvements.

## Existing Project Context

The base application should use React Native.

Backend/database preference:

* MongoDB as the primary database.
* Redis may be used if technically justified.
* Do NOT add Redis simply because it is available.
* If caching, queues, rate limiting, temporary state, background processing, event processing, or another valid use case requires Redis, explain the reason before introducing it.

Screenshots and visual references have been added to the `assets` directory.

You MUST inspect the assets before making UI or design decisions.

Treat the screenshots as design references and infer:

* Layout patterns
* Spacing
* Typography hierarchy
* Card design
* Navigation patterns
* Component structure
* Visual density
* User interaction patterns
* Overall design language

Do not blindly clone screenshots.

Use them to establish a consistent design system for this application.

## Important Working Rules

DO NOT immediately start generating the entire application.

First:

1. Inspect the complete repository.
2. Inspect all files and folders.
3. Inspect package.json and existing dependencies.
4. Inspect the assets directory and all screenshots.
5. Understand the current React Native setup.
6. Identify whether Expo or bare React Native is being used.
7. Identify existing navigation, state management, styling, and API patterns.
8. Identify reusable code and components.
9. Identify technical gaps.
10. Check for existing backend code or infrastructure.

Do not assume information that can be discovered from the repository.

## Clarification Rule

If an architectural, product, UX, authentication, deployment, AI, or data decision cannot be confidently determined from the repository or assets, ASK ME.

Do not silently make major product decisions.

Examples include:

* Authentication method
* Guest mode
* Offline-first requirements
* Background location
* Health integrations
* Apple Health
* Health Connect
* Google Fit
* Notification access
* Calendar access
* Expense detection
* UPI integration
* SMS parsing
* Email parsing
* Food database/API
* Barcode scanning
* Currency handling
* AI provider
* Synthesia AI API and capabilities
* AI data retention
* Deployment infrastructure

IMPORTANT:

Confirm what "Synthesia AI" refers to and inspect any existing integration or documentation before designing provider-specific code.

Do not invent an API or SDK.

Group your questions logically.

Do not ask questions whose answers already exist in the codebase.

## Initial Engineering Task

Before implementing anything, provide a concise technical assessment containing:

### 1. Repository Assessment

Explain:

* Current application structure
* Existing stack
* Existing dependencies
* Current architecture
* Existing reusable components
* Problems or technical debt

### 2. Screenshot / Design Assessment

Inspect every relevant screenshot in `assets`.

Identify:

* Screen purpose
* UI patterns
* Reusable components
* Navigation implications
* Design patterns worth adopting

Derive a unified visual direction.

### 3. Proposed Architecture

Recommend a scalable architecture covering:

* React Native project structure
* Navigation
* State management
* Server state management
* API architecture
* Authentication
* MongoDB
* Validation
* Error handling
* Logging
* Notifications
* Background tasks
* Offline handling
* Personal Context Engine
* Event normalization
* Data synchronization
* AI Context Builder
* Synthesia AI integration boundary
* Analytics readiness

Only introduce technologies that solve a real problem.

### 4. Passive Data Collection Feasibility Matrix

Create a table containing:

* Data source
* Android availability
* iOS availability
* Permission required
* Background support
* Reliability
* Privacy sensitivity
* Recommended for MVP
* Implementation complexity

Evaluate at minimum:

* Health data
* Steps
* Workouts
* Location
* Calendar
* Notifications
* SMS/transaction detection
* UPI/payment context
* Device activity
* Background app execution
* Weather
* Screen/app usage

Do not guess platform capabilities.

### 5. Feature Domain Architecture

Initial domains:

* Expenses
* Habits
* Nutrition
* Water
* Reminders
* Personal Context
* Timeline
* Insights
* User Profile

The architecture should allow future modules such as:

* Sleep
* Mood
* Steps
* Medication
* Screen time
* Study tracking

Do not implement future modules unless requested.

### 6. Database Design

Propose MongoDB models/collections.

At minimum consider:

* User
* Expense
* ExpenseCategory
* Habit
* HabitLog
* FoodEntry
* DailyNutrition
* WaterEntry
* Reminder
* PersonalEvent
* InferredContext
* DailySummary
* AIInsight
* DataSourceConnection
* UserPreference

For every collection explain:

* Purpose
* Important fields
* Relationships
* Indexes
* Data duplication decisions
* Retention considerations

Be extremely careful with timezones and local-day calculations.

### 7. Backend Decision

Evaluate:

* Node.js
* Express
* NestJS
* Fastify

Recommend the best option for this specific product.

Evaluate whether Redis is required.

Consider future background processing and AI insight generation.

If Redis is unnecessary for the MVP, explicitly say so.

If a queue system may eventually be required, explain when it should be introduced.

### 8. Implementation Plan

Create a phased implementation plan.

Phase 1 — Foundation
Phase 2 — Authentication and User Setup
Phase 3 — Personal Context Engine
Phase 4 — Today Timeline
Phase 5 — Expense Tracking
Phase 6 — Habit Tracking
Phase 7 — Calories and Nutrition
Phase 8 — Water and Reminders
Phase 9 — Passive Data Integrations
Phase 10 — Daily Context Aggregation
Phase 11 — Synthesia AI Insights
Phase 12 — Privacy Controls
Phase 13 — Polish, Performance, and Testing

For each phase provide:

* Goal
* Main tasks
* Dependencies
* Expected output

## Code Quality Expectations

Write production-quality code.

Follow:

* Strong TypeScript typing
* Feature/domain architecture
* Clear separation of concerns
* Reusable components
* Small focused files
* Predictable naming
* Centralized configuration
* Environment validation
* Request validation
* Database schema validation
* Error boundaries
* Loading states
* Empty states
* Error states
* Accessible UI
* No unnecessary abstractions
* No premature optimization
* No giant components
* Avoid `any`
* No hardcoded production mock data
* No duplicated business logic

Comments should explain WHY, not WHAT.

## Testing Expectations

Prioritize tests for:

* Expense calculations
* Habit streaks
* Daily completion state
* Calorie totals
* Water totals
* Date handling
* Timezone handling
* Event normalization
* Duplicate event detection
* Context aggregation
* Confidence calculations
* Insight context generation

## Security Expectations

Consider:

* Secure authentication
* Secure mobile token storage
* API authorization
* Input validation
* Rate limiting
* Sensitive personal data
* Health data
* Financial data
* Location data
* AI data exposure
* Environment secrets

Never expose database credentials or backend secrets to the React Native client.

## Execution Behaviour

Work like a senior engineer joining and owning an existing product.

Inspect first.

Understand second.

Plan third.

Ask necessary questions.

Implement only after unclear requirements and architecture decisions are resolved.

Do not rewrite working code without a reason.

Do not introduce dependencies without justification.

Do not create fake APIs.

Do not fake background capabilities.

Do not claim something works unless verified.

After every implementation phase:

1. Run lint and type checks.
2. Run relevant tests.
3. Fix introduced errors.
4. Summarize files changed.
5. Explain architectural decisions.
6. State unresolved issues.
7. Describe the next recommended step.

Start now by inspecting the repository and every screenshot inside `assets`.

DO NOT IMPLEMENT YET.

First provide:

1. Repository assessment
2. Screenshot/design assessment
3. Proposed architecture
4. Passive data collection feasibility matrix
5. Personal Context Engine design
6. Backend recommendation
7. MongoDB data model proposal
8. Redis necessity assessment
9. Synthesia AI integration architecture
10. Phased implementation plan
11. A grouped list of questions you genuinely need me to answer

Do not ask questions until you have inspected everything already available.
