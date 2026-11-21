import { Router } from "express";
import { requireRole, requireArchive } from "../middleware/auth.js";
import { CAN_WRITE_CONTENT } from "../services/accessCodes.js";
import { listPlaces, listTags } from "../services/vocabulary.js";
import { fail } from "../lib/errors.js";

/**
 * The family's own words (059) — the two lists the forms offer back.
 *
 * Reading only. Places and tags are created by the act of using them: you
 * type "Ostend" on a photograph and the place exists, you type "childhood" on
 * a channel and the tag exists. A separate "manage your places" screen would
 * be a second place to keep the same list tidy, and the owner asked for the
 * opposite — a field you can just type in.
 *
 * Both lists are behind the same role as the content they describe. They say
 * nothing about a person, so there is no display-versus-admin split here: a
 * place is "Ostend", not an address.
 */

export const placesRouter = Router();
export const tagsRouter = Router();

placesRouter.get("/", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  try {
    res.json(await listPlaces(archive));
  } catch (err) {
    return fail(res, 500, "The places could not be loaded.", err);
  }
});

tagsRouter.get("/", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  try {
    res.json(await listTags(archive));
  } catch (err) {
    return fail(res, 500, "The tags could not be loaded.", err);
  }
});
