# StoryMaps.io

A simple, interactive user story mapping tool built with vanilla JavaScript.

## Features

- **Backbone** - Define steps (columns) representing the user journey left-to-right
- **Personas & Activities** - Add context rows showing who does what
- **User Stories** - Add stories as post-it notes under each step
- **Release Slices** - Group stories horizontally into releases or priorities
- **Status Indicators** - Mark stories as done, in-progress, or planned
- **Colors & Links** - Customize card colors and add external URLs
- **Drag & Drop** - Reorder stories, steps, and slices
- **Zoom Controls** - Zoom out to see the full board, zoom in for detail
- **Print / PDF** - Print your story map or save as PDF
- **Import/Export** - Save and load story maps as JSON files
- **Local Storage** - Automatically persists your work
- **Samples** - Load example story maps to learn the framework

## Usage

1. Open `index.html` in a browser, or run `node server.js` to start a local server
2. The tutorial loads on first visit to help you get started
3. Click **+** to add steps (columns) to the backbone
4. Click **+** in a column to add user stories
5. Click **+ Add Slice** to create release groupings
6. Click the **...** menu on cards to set colors, status, or links
7. Drag stories to reorder or move between columns
8. Use zoom controls (bottom-right) to zoom in/out
9. Use **Print** to save as PDF, **Export** to save as JSON

## What is User Story Mapping?

User story mapping is a technique for organizing user stories into a visual map that helps teams understand the big picture of a product.

**Structure:**
- **Personas** - Who are the users?
- **Activities** - What are they trying to achieve?
- **Steps** (Backbone) - The journey from left to right
- **User Stories** - Details under each step
- **Slices** - Horizontal groupings for releases (MVP, v1, v2, etc.)

Learn more: [Jeff Patton's Story Mapping](https://jpattonassociates.com/story-mapping/)

## License

MIT
