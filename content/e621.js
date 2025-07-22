// e621.net API scanner
// API docs: https://e621.net/help/api

// e621 allows a hard limit of 2 requests per second.
// Requires authentication via username and API key.
// We unfortunately can't share one API key for all users as it would be throttled or blocked.
// Instead, we prompt users to go to https://e621.net/, log in, go to Settings, and create an API key under basic settings.
// Save the user's API key to the extension's storage and require it for scanning e621.
 // Once we have our user's API key, we can call https://e621.net/favorites.json and get a JSON array of each post in the user's favorites.
 