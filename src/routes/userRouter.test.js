/*
userRouter.docs = [
  {
    method: 'GET',
    path: '/api/user/me',
    requiresAuth: true,
    description: 'Get authenticated user',
    example: `curl -X GET localhost:3000/api/user/me -H 'Authorization: Bearer tttttt'`,
    response: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] },
  },
  {
    method: 'PUT',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Update user',
    example: `curl -X PUT localhost:3000/api/user/1 -d '{"name":"常用名字", "email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt'`,
    response: { user: { id: 1, name: '常用名字', email: 'a@jwt.com', roles: [{ role: 'admin' }] }, token: 'tttttt' },
  },
];
*/

const request = require("supertest");
const app = require("../service");

const testUser = { name: "pizza diner", email: "reg@test.com", password: "a" };
let testUserAuthToken;
let testUserId;

beforeAll(async () => {
  await request(app).post("/api/auth").send(testUser);
  const loginRes = await request(app)
    .put("/api/auth")
    .send({ email: testUser.email, password: testUser.password });
  expect(loginRes.status).toBe(200);
  testUserAuthToken = loginRes.body.token;
  testUserId = loginRes.body.user.id;
  expect(testUserAuthToken).toBeDefined();
});

test("Get authenticated user", async () => {
  const res = await request(app)
    .get("/api/user/me")
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(res.status).toBe(200);
  expect(res.body.email).toBe(testUser.email);
  expect(res.body.name).toEqual(expect.any(String));
  expect(res.body.id).toEqual(expect.any(Number));
  expect(res.body.roles).toEqual(
    expect.arrayContaining([expect.objectContaining({ role: "diner" })])
  );
  expect(res.body.iat).toEqual(expect.any(Number));
});

test("Update user", async () => {
  const res = await request(app)
    .put(`/api/user/${testUserId}`)
    .set("Content-Type", "application/json")
    .set("Authorization", `Bearer ${testUserAuthToken}`)
    .send({ name: "new name", email: "reg@test.com", password: "a" });
  expect(res.status).toBe(200);
});

test("list users unauthorized", async () => {
  const listUsersRes = await request(app).get("/api/user");
  expect(listUsersRes.status).toBe(401);
});

test("list users", async () => {
  const [user, userToken] = await registerUser(request(app));
  const listUsersRes = await request(app)
    .get("/api/user")
    .set("Authorization", "Bearer " + userToken);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body).toEqual(expect.any(Object));
  // depending on test order, there may be other users
  expect(Object.keys(listUsersRes.body).length).toBeGreaterThanOrEqual(1);
  expect(listUsersRes.body[user.id].email).toBe(user.email);
  expect(listUsersRes.body[user.id].name).toBe(user.name);
  expect(listUsersRes.body[user.id].roles).toEqual(
    expect.arrayContaining([expect.objectContaining({ role: "diner" })])
  );
});

test("Delete user unauthorized", async () => {
  const deleteRes = await request(app).delete(`/api/user/${testUserId}`);
  expect(deleteRes.status).toBe(401);
});

test("Delete user", async () => {
  const [user, userToken] = await registerUser(request(app));
  const deleteRes = await request(app)
    .delete(`/api/user/${user.id}`)
    .set("Authorization", `Bearer ${userToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe("user deleted");
});

async function registerUser(service) {
  const testUser = {
    name: "pizza diner",
    email: `${randomName()}@test.com`,
    password: "a",
  };
  const registerRes = await service.post("/api/auth").send(testUser);
  registerRes.body.user.password = testUser.password;

  return [registerRes.body.user, registerRes.body.token];
}

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

afterAll(async () => {
  const deleteRes = await request(app)
    .delete("/api/auth")
    .set("Authorization", `Bearer ${testUserAuthToken}`);
  expect(deleteRes.status).toBe(200);
});
