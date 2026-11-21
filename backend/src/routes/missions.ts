import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { requireRole, requireArchive } from "../middleware/auth.js";
import { CAN_WRITE_CONTENT, CAN_DELETE } from "../services/accessCodes.js";
import { fail } from "../lib/errors.js";
import { logActivity, actorName } from "../services/activityLog.js";
import { channelScope, visibleMission } from "../services/channelVisibility.js";

export const missionsRouter = Router();

const MISSION_COLUMNS =
  "id, title, detail, status, assigned_to, assigned_by, source, origin, rule_key, channel_id, media_id, task_kind, task_count, created_at, updated_at, completed_at";
const MISSION_SELECT = `${MISSION_COLUMNS}, assignee:people!missions_assigned_to_fkey(id, name), assigner:people!missions_assigned_by_fkey(id, name), channel:channels!missions_channel_id_fkey(id, number, title)`;

/**
 * Whether a person id names somebody in this archive. The answer embeds the
 * assignee's name, so an id from another family would read that name back.
 */
async function isArchivePerson(archive: string, personId: unknown): Promise<boolean> {
  if (typeof personId !== "string" || !personId) return false;
  const { data } = await supabase
    .from("people")
    .select("id")
    .eq("id", personId)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();
  return !!data;
}

const TASK_KINDS = ["describe_photos", "link_nfc", "add_photos", "record", "custom", "create_channel"];

/**
 * Missions are tasks people take on: someone decided this should happen and
 * someone will do it. They are deliberately not generated from the archive
 * — what the data itself is missing lives in `suggestions`, which resolves
 * on its own and never lands in anybody's list of work.
 */
missionsRouter.get("/", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { data, error } = await supabase
    .from("missions")
    .select(MISSION_SELECT)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) return fail(res, 500, "Missions could not be loaded.", error);

  /*
    A mission about a channel this reader cannot see is left out whole
    (access-1): the embed carries the channel's title, and Recall's own
    missions quote it in theirs — which is why one of Recall's whose channel
    was permanently deleted (channel_id set null) is left out too.
  */
  let scope;
  try {
    scope = await channelScope(archive, req.profile ?? null, false);
  } catch (err) {
    return fail(res, 500, "Missions could not be loaded.", err);
  }
  res.json(
    (data ?? []).filter((mission) =>
      visibleMission(
        {
          channel_id: mission.channel_id as string | null,
          origin: mission.origin as string | null,
          title: mission.title as string | null,
        },
        scope
      )
    )
  );
});

missionsRouter.post("/", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { title, detail, source, status, assigned_to, channel_id, task_kind, task_count } =
    req.body;

  if (task_kind !== undefined && task_kind !== null && !TASK_KINDS.includes(task_kind)) {
    return res.status(400).json({ error: "Unknown task kind." });
  }

  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "The mission needs a title." });
  }
  if (status !== undefined && status !== "suggested" && status !== "in_progress") {
    return res.status(400).json({ error: "A new mission starts suggested or in progress." });
  }

  // What a mission points at has to be this family's. The row would carry this
  // archive either way, so an unchecked id writes a false claim of ownership —
  // and the mission list joins the channel back in, which would hand another
  // household's channel number and title straight to whoever asked.
  const media_id = req.body?.media_id;

  // And it has to be a channel this person may read: the answer embeds the
  // title, so an id guessed or remembered would otherwise read it back
  // (access-1). Refused as not found, the same answer the channel routes give.
  let scope;
  try {
    scope = await channelScope(archive, req.profile ?? null, false);
  } catch (err) {
    return fail(res, 500, "The mission could not be created.", err);
  }

  if (channel_id) {
    const { data: channel } = await supabase
      .from("channels")
      .select("id")
      .eq("id", channel_id)
      .eq("archive_id", archive)
      .maybeSingle();

    if (!channel || !scope.allows(channel.id as string)) {
      return res.status(404).json({ error: "Channel not found." });
    }
  }

  if (assigned_to && !(await isArchivePerson(archive, assigned_to))) {
    return res.status(404).json({ error: "Person not found." });
  }

  if (media_id) {
    const { data: media } = await supabase
      .from("media_files")
      .select("id, channel_id")
      .eq("id", media_id)
      .eq("archive_id", archive)
      .maybeSingle();

    if (!media || !scope.allows((media.channel_id as string | null) ?? null)) {
      return res.status(404).json({ error: "Media not found." });
    }
  }

  const { data, error } = await supabase
    .from("missions")
    .insert({
      title: title.trim(),
      detail: detail || null,
      source: source || null,
      status: status || "suggested",
      assigned_to: assigned_to || (status === "in_progress" ? req.profile!.personId : null),
      // A task given to someone remembers who gave it.
      assigned_by:
        assigned_to || status === "in_progress" ? req.profile!.personId : null,
      created_by: req.profile!.personId,
      archive_id: archive,
      channel_id: channel_id || null,
      media_id: media_id || null,
      task_kind: task_kind || null,
      task_count: Number.isInteger(task_count) && task_count > 0 ? task_count : null,
    })
    .select(MISSION_SELECT)
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "That suggestion was already accepted." });
    }
    return fail(res, 500, "The mission could not be created.", error);
  }
  res.status(201).json(data);
});

missionsRouter.patch("/:id", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { status, assigned_to } = req.body;

  if (status !== undefined && !["suggested", "in_progress", "completed"].includes(status)) {
    return res.status(400).json({ error: "Unknown mission status." });
  }

  // A mission on a channel this reader cannot see is one they were never
  // shown, and the answer below would embed its title (access-1).
  const { data: existing, error: readError } = await supabase
    .from("missions")
    .select("id, channel_id")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();
  if (readError) return fail(res, 500, "The mission could not be updated.", readError);
  if (!existing) return res.status(404).json({ error: "Mission not found." });
  try {
    const scope = await channelScope(archive, req.profile ?? null, false);
    if (!scope.allows((existing.channel_id as string | null) ?? null)) {
      return res.status(404).json({ error: "Mission not found." });
    }
  } catch (err) {
    return fail(res, 500, "The mission could not be updated.", err);
  }
  if (assigned_to && !(await isArchivePerson(archive, assigned_to))) {
    return res.status(404).json({ error: "Person not found." });
  }

  const { data, error } = await supabase
    .from("missions")
    .update({
      ...(status !== undefined && {
        status,
        completed_at: status === "completed" ? new Date().toISOString() : null,
        // Taking a mission in hand assigns it to whoever pressed Start.
        ...(status === "in_progress" && assigned_to === undefined
          ? { assigned_to: req.profile!.personId, assigned_by: req.profile!.personId }
          : {}),
      }),
      ...(assigned_to !== undefined && {
        assigned_to: assigned_to || null,
        assigned_by: assigned_to ? req.profile!.personId : null,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .select(MISSION_SELECT)
    .maybeSingle();

  if (error) return fail(res, 500, "The mission could not be updated.", error);
  if (!data) return res.status(404).json({ error: "Mission not found." });

  if (status === "completed") {
    logActivity(
      req.profile,
      "mission_completed",
      `${actorName(req.profile)} completed "${data.title}"`,
      // The title may quote the channel's label, so the line points at the
      // channel and inherits its privacy in the activity log.
      (data.channel_id as string | null) ?? null
    );
  }
  res.json(data);
});

missionsRouter.delete("/:id", requireRole(CAN_DELETE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { error } = await supabase
    .from("missions")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null);

  if (error) return fail(res, 500, "The mission could not be removed.", error);
  res.status(204).end();
});
