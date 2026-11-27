// Calendar dates and announcements: create, edit, pin, delete, and who may do it.
import { ok, equal, refused, succeeded, rowsOf, nothingHappened } from "../lib/assert.mjs";
import { mark } from "../lib/ctx.mjs";

const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString();

export default async function calendar(t, ctx) {
  const { c, id } = ctx;
  const g = ctx.state.g;
  const s = (ctx.state.cal = {});
  t.setSection("20 calendar and announcements");

  await t.test("executive adds a club-wide calendar date (as the Add important date form does); every member sees it", async () => {
    const row = succeeded(await c.execA.from("events").insert({ title: mark("Spring concert"), description: "club wide", starts_at: inDays(10), location: "Memorial Hall", subgroup_id: null, created_by: id.execA }).select("id"), "insert event");
    ok(row.length === 1, `insert returned ${row.length} rows`);
    s.eventId = row[0].id;
    for (const key of ["member1", "member2", "leader"]) {
      const boot = succeeded(await c[key].rpc("get_portal_bootstrap"), `${key} bootstrap`);
      ok(boot.events.some((e) => e.id === s.eventId), `${key} cannot see the new club-wide date`);
    }
  });

  await t.test("executive edits the date: the update changes the row, bumps updated_at, and members see the new title", async () => {
    const before = succeeded(await c.execA.from("events").select("title,updated_at").eq("id", s.eventId).single(), "read before");
    await new Promise((r) => setTimeout(r, 1100));
    const res = await c.execA.from("events").update({ title: mark("Spring concert (moved)"), description: "edited", starts_at: inDays(12), location: "Hill Hall", subgroup_id: null }).eq("id", s.eventId).select("id");
    equal(succeeded(res, "update event").length, 1, "rows updated");
    const after = succeeded(await c.member1.from("events").select("title,location,updated_at").eq("id", s.eventId).single(), "member reads after");
    equal(after.title, mark("Spring concert (moved)"), "title seen by member");
    equal(after.location, "Hill Hall", "location seen by member");
    ok(new Date(after.updated_at) > new Date(before.updated_at), `updated_at did not advance (${before.updated_at} -> ${after.updated_at})`);
  });

  await t.test("a plain member and a group manager cannot add, edit or delete calendar dates", async () => {
    for (const key of ["member1", "manager"]) {
      refused(await c[key].from("events").insert({ title: mark("sneaky"), description: "", starts_at: inDays(1), location: "", created_by: id[key] }).select("id"), `${key} inserting an event`);
      nothingHappened(await c[key].from("events").update({ title: "hijacked" }).eq("id", s.eventId).select("id"), `${key} updating an event`);
      nothingHappened(await c[key].from("events").delete().eq("id", s.eventId).select("id"), `${key} deleting an event`);
    }
    const still = succeeded(await c.execA.from("events").select("title").eq("id", s.eventId).single(), "re-read");
    equal(still.title, mark("Spring concert (moved)"), "title after refused edits");
  });

  await t.test("a date for one group is seen by that group's members and by executives, not by members of other groups", async () => {
    const seen = async (key) => rowsOf(await c[key].from("events").select("id").eq("id", g.evA), `${key} reading group A event`).length;
    equal(await seen("member1"), 1, "member1 (group A) sees it");
    equal(await seen("leader"), 1, "leader (group A) sees it");
    equal(await seen("execB"), 1, "an executive sees it");
    equal(await seen("member2"), 0, "member2 (group B only) sees it");
  });

  await t.test("executive removes a calendar date and it is gone for members", async () => {
    succeeded(await c.execA.from("events").delete().eq("id", s.eventId).select("id"), "delete event");
    succeeded(await c.execA.from("events").delete().eq("id", g.evA), "delete group A event");
    equal(rowsOf(await c.member1.from("events").select("id").in("id", [s.eventId, g.evA]), "member re-read").length, 0, "events still visible after delete");
  });

  await t.test("executive posts, edits, pins and unpins an announcement; the pinned one sorts first in the portal bootstrap", async () => {
    const first = succeeded(await c.execA.from("announcements").insert({ title: mark("Notice one"), body: "first", is_pinned: false, subgroup_id: null, created_by: id.execA }).select("id"), "post one")[0].id;
    const second = succeeded(await c.execA.from("announcements").insert({ title: mark("Notice two"), body: "second", is_pinned: false, subgroup_id: null, created_by: id.execA }).select("id"), "post two")[0].id;
    s.ann = [first, second];
    const edit = await c.execA.from("announcements").update({ title: mark("Notice one (edited)"), body: "first, edited", is_pinned: false, subgroup_id: null }).eq("id", first).select("id");
    equal(succeeded(edit, "edit announcement").length, 1, "rows edited");
    succeeded(await c.execA.from("announcements").update({ is_pinned: true }).eq("id", first), "pin");
    let boot = succeeded(await c.member1.rpc("get_portal_bootstrap"), "bootstrap after pin");
    const mine = boot.announcements.filter((a) => s.ann.includes(a.id));
    equal(mine.map((a) => a.id)[0], first, "pinned announcement first");
    equal(mine.find((a) => a.id === first).title, mark("Notice one (edited)"), "edited title seen by member");
    ok(mine.find((a) => a.id === first).updated_at >= mine.find((a) => a.id === first).created_at, "updated_at set");
    succeeded(await c.execA.from("announcements").update({ is_pinned: false }).eq("id", first), "unpin");
    boot = succeeded(await c.member1.rpc("get_portal_bootstrap"), "bootstrap after unpin");
    const order = boot.announcements.filter((a) => s.ann.includes(a.id)).map((a) => a.is_pinned);
    ok(order.every((pinned) => pinned === false), `announcements still pinned after unpin: ${JSON.stringify(order)}`);
  });

  await t.test("a second executive can edit and delete an announcement written by the first (executive-wide rule)", async () => {
    equal(succeeded(await c.execB.from("announcements").update({ body: "edited by B" }).eq("id", s.ann[1]).select("id"), "execB edit").length, 1, "rows edited by B");
    succeeded(await c.execB.from("announcements").delete().eq("id", s.ann[1]), "execB delete");
    equal(rowsOf(await c.execA.from("announcements").select("id").eq("id", s.ann[1]), "re-read").length, 0, "announcement deleted by B still present");
  });

  await t.test("a plain member and a group manager cannot post, edit, pin or delete announcements; an executive cannot post in someone else's name", async () => {
    for (const key of ["member1", "manager"]) {
      refused(await c[key].from("announcements").insert({ title: mark("sneaky"), body: "x", is_pinned: true, created_by: id[key] }).select("id"), `${key} posting`);
      nothingHappened(await c[key].from("announcements").update({ is_pinned: true }).eq("id", s.ann[0]).select("id"), `${key} pinning`);
      nothingHappened(await c[key].from("announcements").update({ title: "hijacked" }).eq("id", s.ann[0]).select("id"), `${key} editing`);
      nothingHappened(await c[key].from("announcements").delete().eq("id", s.ann[0]).select("id"), `${key} deleting`);
    }
    refused(await c.execA.from("announcements").insert({ title: mark("impersonated"), body: "x", created_by: id.execB }).select("id"), "executive posting as another user");
    equal(succeeded(await c.execA.from("announcements").select("title,is_pinned").eq("id", s.ann[0]).single(), "re-read").title, mark("Notice one (edited)"), "title after refused edits");
  });

  await t.test("executive deletes the announcement", async () => {
    succeeded(await c.execA.from("announcements").delete().eq("id", s.ann[0]), "delete");
    equal(rowsOf(await c.member1.from("announcements").select("id").eq("id", s.ann[0]), "member re-read").length, 0, "announcement visible after delete");
    succeeded(await c.execA.from("announcements").delete().eq("id", g.annA), "delete group A announcement");
  });

  await t.test("a member edits their own profile name and phone, but not someone else's", async () => {
    const own = await c.member2.from("profiles").update({ full_name: "E2E Member Two", phone: "919-555-0102", class_year: "2028", specialty: "Carnatic vocal" }).eq("id", id.member2).select("id,phone");
    equal(succeeded(own, "update own profile").length, 1, "rows updated");
    nothingHappened(await c.member2.from("profiles").update({ full_name: "hijacked" }).eq("id", id.member1).select("id"), "updating someone else's profile");
  });
}
