# Storymaps.io

**https://storymaps.io**

A simple, interactive user story mapping tool built with vanilla JavaScript.

## What is User Story Mapping?
User story mapping is a technique for organising user stories into a visual map that helps teams understand the big picture of a software project, feature, or product. More importantly, it helps teams agree on what the product should do and how it should be built. It acts as a canonical source of information for the team that can be referenced throughout the project.

It's not a replacement for Jira, Trello, Phabricator, or any other scrum project management tool. Instead, it's to be used alongside them to visualise the big picture of the work being done and keep track of progress. Think of it as a visual way to organise your backlog in a way that makes sense to everyone.

### The Power of the Big Picture
User story mapping transforms a flat, disconnected backlog into a living visual narrative that ensures your team never loses sight of the user’s journey. While traditional tools are excellent for tracking individual tasks, they often obscure the "why" behind the work.

By mapping out the backbone of the user experience, you can instantly spot functional gaps. For example, if you are building a Travel Booking System, you might realise you’ve planned the "Search" and "Payment" modules but completely forgotten the "Booking Confirmation and Voucher" step. In a standard list, these gaps stay hidden; in a map, the empty space in the user's journey is obvious.



### User Story Mapping Structure:
- **Personas** - Who are the users? e.g. first-time shopper
- **Activities** - What are they trying to achieve? e.g. find a product
- **Steps** - The journey they take to achieve their goals from left to right e.g. search -> browse -> compare
- **User Stories** - Details under each step explaing e.g. (search) keyword search, (browse) filter product list results, (compare) side-by-side view
- **Slices** - Horizontal groupings for releases (MVP, v1, v2, etc.)

## App Features
- **Real-time Collaboration** - Multiple users can edit the same map simultaneously
- **Shareable URLs** - Each map gets a unique URL for easy sharing
- **Personas** - Add context rows showing who does what
- **Activities & Steps (Backbone)** - Define activities & steps representing the user journey left-to-right
- **User Stories** - Add user stories under each step to break down the task.
- **Release Slices** - Group stories horizontally into releases or priorities
- **Status Indicators** - Mark stories as done, in-progress, or planned
- **Colours & Links** - Customize card colours and add external URLs to your existing task management tools
- **Drag & Drop** - Reorder cards and slices
- **Undo/Redo** - Ctrl+Z/Ctrl+Y to undo and redo changes
- **Zoom Controls** - Zoom out to see the full board, zoom in for detail
- **Print / PDF** - Print your story map or save as PDF
- **Import/Export** - Save and load story maps as JSON files
- **Local Storage** - Automatically save your work
- **Samples** - Load example story maps to learn the framework

## Self-Hosting Setup

This app uses Firebase for real-time collaboration and cloud storage. To run your own instance:

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com/)
2. Enable Firestore Database in your project
3. Set up App Check with reCAPTCHA v3 at [console.cloud.google.com/security/recaptcha](https://console.cloud.google.com/security/recaptcha)
4. Copy `config.example.js` to `config.js`
5. Add your Firebase credentials and reCAPTCHA site key to `config.js`
6. Serve the files with any static web server

Note: Data is always saved to local storage. Real-time collaboration and cloud sync require Firebase.

## Usage
1. Visit [storymaps.io](https://storymaps.io) or serve locally with `node server.js`
2. Click **New Story Map** or try a sample to get started
3. Click **+** to add steps (columns) to the backbone
4. Click **+** in a column to add user stories
5. Click **+ Add Slice** to create release groupings
6. Click the **...** menu on cards to set colors, status, or links
7. Drag stories to reorder or move between columns
8. Click **Share** to copy the URL and collaborate with others
9. Use **Ctrl+Z** / **Ctrl+Y** to undo and redo changes
10. Use zoom controls (bottom-right) to zoom in/out
11. Use **Print** to save as PDF, **Export** to save as JSON

## Credit
Thanks to Jeff Patton for pioneering user story mapping. Learn more: [Jeff Patton's Story Mapping](https://jpattonassociates.com/story-mapping/)

## License
MIT
