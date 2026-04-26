import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  test,
  expect,
  describe,
  beforeAll,
  beforeEach,
  afterAll,
} from "bun:test";

const tmpDir = mkdtempSync(join(tmpdir(), "rl-projects-test-"));

type ProjectsModule = typeof import("./projects");
type UsersModule = typeof import("./users");
let P: ProjectsModule;
let U: UsersModule;

// Stable uid + role fixtures so the visibility filter has something to
// consult via findUserById during listProjects/getProject/canView.
let ADMIN_UID: string;
let USER_UID: string;

beforeAll(async () => {
  process.env.PROJECTS_DIR = tmpDir;
  process.env.USER_STORE_PATH = join(tmpDir, "..", "rl-projects-users.json");
  U = await import("./users");
  P = await import("./projects");
});

beforeEach(() => {
  // Reset: remove everything under tmpDir, then recreate tmpDir itself.
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  // Reset the users store too, so each test starts with fresh admin+user.
  const usersPath = process.env.USER_STORE_PATH!;
  if (existsSync(usersPath)) rmSync(usersPath);
  const admin = U.createUser({
    email: "admin-fx@test.local",
    password: "pass-pass-1234",
    role: "admin",
  });
  const regular = U.createUser({
    email: "user-fx@test.local",
    password: "pass-pass-1234",
    role: "user",
  });
  if (!admin.ok || !regular.ok) throw new Error("fixture user setup failed");
  ADMIN_UID = admin.user.id;
  USER_UID = regular.user.id;
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeProject(
  slug: string,
  contents: Record<string, unknown | string>,
  ownerUid?: string
) {
  const dir = join(tmpDir, slug);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "sources"), { recursive: true });
  for (const [rel, body] of Object.entries(contents)) {
    const target = join(dir, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(
      target,
      typeof body === "string" ? body : JSON.stringify(body)
    );
  }
  if (ownerUid) P.setOwner(slug, ownerUid);
}

describe("listProjects", () => {
  test("returns [] when root does not exist", () => {
    process.env.PROJECTS_DIR = join(tmpDir, "nope");
    expect(P.listProjects(USER_UID)).toEqual([]);
    process.env.PROJECTS_DIR = tmpDir;
  });

  test("ignores directories without plan.json", () => {
    mkdirSync(join(tmpDir, "empty-dir"));
    expect(P.listProjects(USER_UID)).toEqual([]);
  });

  test("reports question-first project with facts and sources index", () => {
    makeProject(
      "qf-project",
      {
        "plan.json": {
          topic: "test topic",
          questions: [{ id: "Q1", subquestions: [{ id: "Q1.1" }] }],
        },
        "facts.json": [{ id: "F1" }, { id: "F2" }, { id: "F3" }],
        "sources/index.json": { total_sources: 42, total_learnings: 15 },
        "REPORT.md": "# Report",
      },
      USER_UID
    );
    const list = P.listProjects(USER_UID);
    expect(list.length).toBe(1);
    const p = list[0]!;
    expect(p.slug).toBe("qf-project");
    expect(p.schema).toBe("question_first");
    expect(p.owner_uid).toBe(USER_UID);
    expect(p.is_showcase).toBe(false);
    expect(p.facts).toBe(3);
    expect(p.sources).toBe(42);
    expect(p.learnings).toBe(15);
    expect(p.hasReport).toBe(true);
  });

  test("reports legacy hypothesis-first project with claims and critic", () => {
    makeProject(
      "hf-project",
      {
        "plan.json": {
          topic: "legacy",
          hypotheses: [{ id: "H1" }, { id: "H2" }],
        },
        "claims.json": [{ id: "C1" }, { id: "C2" }, { id: "C3" }],
        "critic_report.json": { overall_confidence: 0.78 },
      },
      USER_UID
    );
    const p = P.listProjects(USER_UID)[0]!;
    expect(p.schema).toBe("hypothesis_first");
    expect(p.hypotheses).toBe(2);
    expect(p.claims).toBe(3);
    expect(p.confidence).toBe(0.78);
    expect(p.hasReport).toBe(false);
  });

  test("detects 'empty' schema when plan has neither questions nor hypotheses", () => {
    makeProject("bare", { "plan.json": { topic: "bare-plan" } }, USER_UID);
    expect(P.listProjects(USER_UID)[0]!.schema).toBe("empty");
  });

  test("recovers from malformed facts.json (treats as 0 facts)", () => {
    makeProject(
      "broken-facts",
      {
        "plan.json": { topic: "t", questions: [] },
        "facts.json": "not json",
      },
      USER_UID
    );
    const p = P.listProjects(USER_UID)[0]!;
    expect(p.facts).toBe(0);
  });

  test("admin-owned projects appear as showcase for any viewer", () => {
    makeProject("showcase", { "plan.json": { topic: "t", questions: [] } }, ADMIN_UID);
    const asUser = P.listProjects(USER_UID);
    expect(asUser.length).toBe(1);
    expect(asUser[0]!.is_showcase).toBe(true);
    const anon = P.listProjects(null);
    expect(anon.length).toBe(1);
  });

  test("one user's private project is invisible to another user", () => {
    makeProject("private", { "plan.json": { topic: "t", questions: [] } }, USER_UID);
    const otherUser = U.createUser({
      email: "other@test.local",
      password: "pass-pass-1234",
      role: "user",
    });
    if (!otherUser.ok) throw new Error("setup");
    expect(P.listProjects(otherUser.user.id).length).toBe(0);
    expect(P.listProjects(USER_UID).length).toBe(1);
  });

  test("unowned projects are invisible to users (not auto-assigned to admin)", () => {
    const dir = join(tmpDir, "orphan");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "plan.json"),
      JSON.stringify({ topic: "orphan", questions: [] })
    );
    // no setOwner — simulates race-loss on run start
    expect(P.listProjects(USER_UID).length).toBe(0);
    expect(P.listProjects(null).length).toBe(0);
    // But admin still sees it (god viewer, for manual cleanup)
    expect(P.listProjects(ADMIN_UID).length).toBe(1);
  });
});

describe("getProject", () => {
  test("returns null for unknown slug", () => {
    expect(P.getProject("does-not-exist", USER_UID)).toBeNull();
  });

  test("returns full detail bundle for the owner", () => {
    makeProject(
      "full",
      {
        "plan.json": {
          topic: "full project",
          questions: [{ id: "Q1" }, { id: "Q2" }],
        },
        "facts.json": [{ id: "F1" }],
        "analysis_report.json": { answers: [] },
        "verification.json": { summary: { total: 1, verified: 1 } },
        "REPORT.md": "# Final",
        "sources/index.json": { total_sources: 10 },
        "sources/Q1.json": {
          subquestion_id: "Q1.1",
          results: [{ title: "a", url: "u", snippet: "s", provider: "arxiv", query: "q" }],
        },
        "sources/Q2.1.json": {
          subquestion_id: "Q2.1",
          results: [],
        },
        "sources/not-a-unit.json": { just: "skip me" },
      },
      USER_UID
    );
    const p = P.getProject("full", USER_UID);
    expect(p).not.toBeNull();
    expect(p!.schema).toBe("question_first");
    expect(p!.facts.length).toBe(1);
    expect(p!.report).toBe("# Final");
    expect(p!.verification.summary.verified).toBe(1);
    expect(p!.units.length).toBe(2);
    const unit = p!.units[0];
    const r = unit.results[0];
    if (r) {
      expect(Object.keys(r).sort()).toEqual(
        ["provider", "query", "snippet", "title", "url"].sort()
      );
    }
  });

  test("returns null when viewer doesn't own project and it's not showcase", () => {
    makeProject("private", { "plan.json": { topic: "t", questions: [] } }, USER_UID);
    expect(P.getProject("private", "u_stranger")).toBeNull();
    expect(P.getProject("private", null)).toBeNull();
  });

  test("admin-owned project is visible to any viewer (showcase)", () => {
    makeProject("demo", { "plan.json": { topic: "t", questions: [] } }, ADMIN_UID);
    expect(P.getProject("demo", USER_UID)).not.toBeNull();
    expect(P.getProject("demo", null)).not.toBeNull();
  });

  test("handles project with no sources directory", () => {
    const dir = join(tmpDir, "no-sources");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "plan.json"),
      JSON.stringify({ topic: "t", questions: [] })
    );
    P.setOwner("no-sources", USER_UID);
    const p = P.getProject("no-sources", USER_UID);
    expect(p).not.toBeNull();
    expect(p!.units).toEqual([]);
  });

  test("loads debt status sidecar for project detail", () => {
    makeProject(
      "debtful",
      {
        "plan.json": { topic: "t", questions: [] },
        "debt_status.json": {
          D1: {
            status: "resolved",
            updated_at: 123,
            updated_by: USER_UID,
            branch_slug: "branch-a",
          },
        },
      },
      USER_UID
    );
    const p = P.getProject("debtful", USER_UID);
    expect(p?.debtStatus.D1.status).toBe("resolved");
    expect(p?.debtStatus.D1.branch_slug).toBe("branch-a");
  });
});

describe("canView", () => {
  test("owner can view their own project", () => {
    makeProject("p", { "plan.json": {} }, USER_UID);
    expect(P.canView("p", USER_UID)).toBe(true);
  });

  test("anyone can view showcase (admin-owned)", () => {
    makeProject("p", { "plan.json": {} }, ADMIN_UID);
    expect(P.canView("p", USER_UID)).toBe(true);
    expect(P.canView("p", null)).toBe(true);
  });

  test("cannot view other user's private project", () => {
    makeProject("p", { "plan.json": {} }, USER_UID);
    expect(P.canView("p", "u_other")).toBe(false);
  });

  test("admin viewer can view any project (moderation / debug path)", () => {
    makeProject("p", { "plan.json": {} }, USER_UID);
    expect(P.canView("p", ADMIN_UID)).toBe(true);
    expect(P.getProject("p", ADMIN_UID)).not.toBeNull();
    expect(P.listProjects(ADMIN_UID).length).toBeGreaterThan(0);
  });
});
