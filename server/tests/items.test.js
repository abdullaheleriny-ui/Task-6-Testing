// Backend tests for /api/items — THIS is the only backend file you edit.
// Run with:  npm test --workspace server
//
// tests/setup.js already starts an in-memory MongoDB and empties it after
// every test, so each test starts from a clean database.
import request from 'supertest';
import app from '../src/app.js';

// Helper: registers a user and returns their JWT.
// Use different names/emails when you need two users (e.g. for the 403 test).
async function registerAndGetToken(name = 'Alice', email = 'alice@test.com') {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password: 'secret123' });
  return res.body.token;
}

// Helper: creates an item as the user owning `token` and returns it.
// Override any field: createItem(token, { title: 'Keys', status: 'found' })
async function createItem(token, body = {}) {
  const res = await request(app)
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Black backpack', status: 'lost', category: 'accessories', location: 'Library', ...body });
  return res.body.item;
}

describe('/api/items', () => {
  // Worked example — read it, then write the two tests below in the same style.
  test('GET is public and returns an empty list when there are no items', async () => {
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  // Test 1: reporting the same item at the same location twice is rejected.
  // async allows await, which waits for each request to finish before continuing.
  test('POST returns 409 when the same title is reported at the same location twice', async () => {
    // Register the default user, Alice, and get her JWT (proof of login).
    const token = await registerAndGetToken();
    // Create the first report: Black backpack at Library, using Alice's token.
    const item = await createItem(token);
    // Confirm the first report was created and has a database ID.
    expect(item).toHaveProperty('_id');

    // Prepare a request to the Express app; await stores the completed response in res.
    const res = await request(app)
      // POST asks the API to create another item report.
      .post('/api/items')
      // Send Alice's login token in the Authorization header.
      .set('Authorization', `Bearer ${token}`)
      // Reuse the first report's title and location to deliberately make a duplicate.
      .send({ title: item.title, location: item.location, status: 'lost', category: 'accessories' });

    // Check for HTTP 409 (Conflict), the expected response for a duplicate.
    expect(res.status).toBe(409);
    // Check that the response explains why the report was rejected.
    expect(res.body.message).toBe('Duplicate item at this location');
    // Fetch all items to check what is actually stored after the rejected request.
    const list = await request(app).get('/api/items');
    // Only the original item should exist; the duplicate must not have been saved.
    expect(list.body.items).toHaveLength(1);
  });

  // Test 2: a logged-in user cannot edit an item reported by someone else.
  test('PATCH returns 403 when someone who is not the reporter edits the item', async () => {
    // Register Alice and keep her token so she can report an item.
    const reporterToken = await registerAndGetToken();
    // Register a different user, Bob, with a different email and login token.
    const otherToken = await registerAndGetToken('Bob', 'bob@test.com');
    // Create the item as Alice, making her its reporter (owner).
    const item = await createItem(reporterToken);
    // Confirm the item exists and has an ID before trying to edit it.
    expect(item).toHaveProperty('_id');

    // Send an edit request and store the API's response in res.
    const res = await request(app)
      // PATCH updates an existing item; ${item._id} inserts this item's ID into the URL.
      .patch(`/api/items/${item._id}`)
      // Use Bob's token, so the person requesting the edit is NOT the reporter.
      .set('Authorization', `Bearer ${otherToken}`)
      // Try to replace Alice's original item title.
      .send({ title: 'Changed title' });

    // Check for HTTP 403 (Forbidden): Bob is logged in but lacks permission.
    expect(res.status).toBe(403);
    // Fetch the item again to see whether the rejected edit changed its stored data.
    const unchanged = await request(app).get(`/api/items/${item._id}`);
    // Compare the stored title with the original title; they must still match.
    expect(unchanged.body.item.title).toBe(item.title);
  });
});
