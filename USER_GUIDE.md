# Nadeef — User Guide (with screenshots)

## Table of contents

- [Sign up](#sign-up)
- [Sign in](#sign-in)
- [Create a house](#create-a-house)
- [Share a house with a friend](#share-a-house-with-a-friend)
- [Create a room](#create-a-room)
- [Edit a room](#edit-a-room)
- [Create a task](#create-a-task)
- [Task Library vs Custom task](#task-library-vs-custom-task)
- [Edit a task](#edit-a-task)
- [Skip / postpone a task](#skip--postpone-a-task)
- [Know task details](#know-task-details)
- [Task permissions (roles)](#task-permissions-roles)
- [Filtering in the Tasks list](#filtering-in-the-tasks-list)
- [Update profile name or image](#update-profile-name-or-image)
- [Enable notifications](#enable-notifications)
- [How the score is calculated](#how-the-score-is-calculated)
- [How to undo a task](#how-to-undo-a-task)

---

## Sign up

1. Open the app.
2. On the login screen, choose the **Sign up** option.
3. Enter your email + password and submit.
4. You’ll be redirected into the app.

Screenshot:

![Sign up](./docs/screenshots/02-signup.png)

---

## Sign in

1. Open the app.
2. On the login screen, choose **Sign in**.
3. Enter your email + password and submit.

Screenshot:

![Sign in](./docs/screenshots/01-signin.png)

---

## Create a house

1. After login, if you don’t have a house yet you’ll be guided to setup.
2. Create your house/home (name + settings).
3. If you see an option for **number of rooms** (or starter rooms):
   - choose how many rooms you want to start with
   - you can always add more rooms later
3. Once created, you’ll land on the home dashboard.

Screenshot:

![Create house / setup](./docs/screenshots/03-setup-house.png)

---

## Share a house with a friend

1. Open **Profile**.
2. Copy your **Invite Code**.
3. Share the code with your friend.
4. Your friend logs in and uses the invite code during setup to join your house.

Screenshot:

![Profile invite code](./docs/screenshots/05-profile-invite.png)

---

## Create a room

1. Open **Home**.
2. Tap **Add Room**.
3. Choose a room type (e.g. Kitchen), give it a name/icon, then save.

Screenshot:

![Add room](./docs/screenshots/06-add-room.png)

---

## Edit a room

1. Open the room you want to edit.
2. Tap the **Edit Room** option.
3. Update the room **name** and/or **icon**, then save.

Tip:
- Deleting a room removes the room **and all tasks inside it**.

Screenshot:

![Room details](./docs/screenshots/07-room-details.png)

---

## Create a task

1. Open a room (e.g. Kitchen).
2. Tap **Add Task**.
3. Fill in:
   - **Task name**
   - **Frequency** (every X days/weeks)
   - **Starting due date**
   - **Assignee(s)**
   - **Effort**
4. Save the task.

Screenshot:

![Add task](./docs/screenshots/08-add-task.png)

---

## Task Library vs Custom task

When you add a task, you can create tasks in two ways:

- **Task Library**: pick a suggested task template for the room type (fast setup).
- **Custom task**: create your own task name and settings.

Typical flow:

1. Open a room.
2. Tap **Add Task**.
3. Choose **Library** or **Custom**.
4. Fill in frequency / due date / assignees / effort, then save.

Screenshot:

![Add task](./docs/screenshots/08-add-task.png)

---

## Edit a task

You can edit from **Room details** or **All Tasks**:

1. Swipe the task card to reveal actions.
2. Tap **Edit**.
3. Update fields (name, due date, frequency, effort, assignees), then save.

Screenshots:

![Room details](./docs/screenshots/07-room-details.png)

![All tasks list](./docs/screenshots/09-all-tasks.png)

---

## Skip / postpone a task

**Skip is only available for overdue tasks or tasks due today** (future tasks cannot be skipped).

From **Room details** or **All Tasks**:

1. Swipe the task card to reveal actions.
2. Tap **Skip**.
3. A popup appears:
   - **Postpone to tomorrow**
   - **Skip until next cycle** (moves due date forward by the task frequency)
   - **Cancel**

Screenshots:

![Skip popup](./docs/screenshots/11-skip-popup.png)

---

## Know task details

1. Tap a task name to open **Task Details**.
2. You can see:
   - due date
   - frequency
   - effort points
   - completion history (who/when, points)
3. From this screen you can also **Edit**, **Skip** (if due/overdue), or **Delete**.

Screenshots:

![Task details](./docs/screenshots/10-task-details.png)

---

## Task permissions (roles)

Nadeef has different member roles inside a house. What you can do depends on your role:

- **Owner / Member**
  - can create/edit/delete rooms and tasks
  - can complete tasks and manage the home
  - can skip/postpone tasks that are **due today** or **overdue**
- **Helper**
  - can view tasks and complete tasks
  - cannot edit/delete rooms/tasks
  - cannot skip/postpone tasks

If you don’t see **Edit / Skip / Delete** actions, you are likely logged in as a **Helper**.

---

## Filtering in the Tasks list

On **All Tasks**:

1. Tap the **Filters** button.
2. You can filter by:
   - **Room**
   - **Due date** (Overdue, Due today, Due tomorrow, This week, This month, Later)
   - **Assignee** (All, Me, or a specific member)
3. Use **Clear** to reset.

Tip:
- Filters + scroll position are remembered when you open a task and go back.

Screenshot:

![All tasks list](./docs/screenshots/09-all-tasks.png)

---

## Update profile name or image

1. Open **Profile**.
2. Change your **display name**.
3. To change your **profile image**:
   - choose an image from your gallery or camera (if available on your device)
   - save changes

Screenshot:

![Profile invite code](./docs/screenshots/05-profile-invite.png)

---

## Enable notifications

1. Open **Profile**.
2. Turn **Notifications** on.
3. When your browser prompts you, click **Allow**.

Notes:
- Notifications require a browser/device that supports push notifications.
- If you previously blocked notifications, you must re-enable them in your browser site settings.

Screenshot:

![Profile invite code](./docs/screenshots/05-profile-invite.png)

---

## How the score is calculated

The leaderboard uses a **Smart Score** (scaled to 0–1000) with these weights:

- **20% Effort points**: points earned from completing tasks
- **20% Completed tasks**: number of completed tasks
- **30% Home freshness**: how many tasks are *not* currently due/overdue
- **30% Streak**: your current streak days

Screenshot (leaderboard):

![Leaderboard](./docs/screenshots/04-home.png)

---

## How to undo a task

Undo is available from **Completed Tasks**:

1. Open **Home**.
2. Go to **Completed Tasks**.
3. Find the completion entry and tap **Undo Task**.

What happens when you undo:

- the completion record is removed
- the task’s due date/last-completed state is recalculated
- points are adjusted down accordingly

Screenshot (home dashboard entry point):

![Completed tasks undo](./docs/screenshots/12-completed-undo.png)

