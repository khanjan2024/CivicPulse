# Civic Pulse

An application for reporting civic issues anonymously (or via citizen account) with a dedicated local authority dashboard to track, manage, and resolve reported problems.

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: SQLite (via `sqlite3` driver)
- **Templating Engine**: EJS (Embedded JavaScript) with `express-ejs-layouts`
- **Session Management**: `express-session` for user authentication
- **File Uploads**: `multer` for handling uploaded civic issue images
- **Security**: `bcryptjs` for password hashing

---

## Features

### 1. User Roles & Authentication
- **Citizen**:
  - Can sign up and log in using an email and password.
  - Can report new civic issues, specifying the category, address (State, District, Post Office, Pincode), details, and an optional image.
  - Can view a history of their submitted reports and track their current status.
- **Authority**:
  - Requires a specific Authority Code, State, and District on registration.
  - Can log in and view a dashboard filtering only the reports submitted within their specific State and District.
  - Can update the status of reports (`unsolved`, `pending`, `resolved`).

### 2. Anonymous / Authenticated Reporting
- Citizen accounts allow users to view their dashboard.
- Civic issues are logged in a SQLite database with automatic timestamp tracking.

---

## Folder Structure

```text
├── database.sqlite       # SQLite database file (auto-generated)
├── package.json          # Node dependencies and scripts
├── server.js             # Express application logic and database schema setup
├── uploads/              # Directory for uploaded issue images (auto-generated)
├── public/               # Static assets (CSS, client JS, images)
└── views/                # EJS view templates
    ├── layout.ejs        # Main layout wrapper
    ├── index.ejs         # Landing / Homepage
    ├── login.ejs         # Login page (Citizen & Authority modes)
    ├── signup.ejs        # Signup page (Citizen & Authority modes)
    ├── citizen_dashboard.ejs    # Citizen report history view
    ├── new_report.ejs    # File submission / Issue reporting form
    └── authority_dashboard.ejs  # Authority control panel for updating statuses
```

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16+ recommended)
- npm (Node Package Manager)

### Installation
1. Clone or download this project.
2. Open your terminal in the project root directory.
3. Install the dependencies:
   ```bash
   npm install
   ```

### Running the App
- **Development Mode** (with automatic hot-reload via `nodemon`):
  ```bash
  npm run dev
  ```
- **Production Mode**:
  ```bash
  npm start
  ```

Once started, the application will be accessible at: **[http://localhost:3001](http://localhost:3001)**

---

## Database Schema

The SQLite database (`database.sqlite`) is initialized automatically when the server starts. It contains two main tables:

### `users`
- `id` (INTEGER, Primary Key)
- `email` (TEXT, Unique)
- `password_hash` (TEXT)
- `role` (TEXT: `citizen` or `authority`)
- `authority_code` (TEXT, Nullable)
- `authority_state` (TEXT, Nullable)
- `authority_district` (TEXT, Nullable)

### `reports`
- `id` (INTEGER, Primary Key)
- `reporter_id` (INTEGER, Foreign Key referencing `users(id)`)
- `state` (TEXT)
- `district` (TEXT)
- `post_office` (TEXT)
- `pincode` (TEXT)
- `civic_type` (TEXT: e.g. `Garbage`, `Road Damage`, `Water Logging`, `Street Light`, `Other`)
- `description` (TEXT, Nullable)
- `image_path` (TEXT, Nullable)
- `status` (TEXT: `unsolved`, `pending`, `resolved`)
- `created_at` (DATETIME, default current timestamp)
- `updated_at` (DATETIME, default current timestamp)
