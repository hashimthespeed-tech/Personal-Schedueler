# Permanent Task Deletion Design

## Goal

Let Hashim permanently delete the exact saved object he selected. Deletion has no archive, trash, or undo state.

## Product behavior

### Today

Every saved task row has a **Delete** action. After Hashim confirms `Delete “<task name>” forever?`, the selected scheduled-task record is permanently removed. This applies to planned, completed, and unplaced tasks.

Generated recurring commitments—prayers, wrestling, and workouts—do not receive Delete actions. They are schedule rules rather than saved task records and remain checkable.

### Week

The existing task editor sheet gains a **Delete task forever** action. It permanently removes only the selected scheduled-task record, including when that task is one session of a larger school assignment. Other sessions and the parent assignment remain.

### Due

Every assignment in **Coming up** gains a **Delete assignment** action. After confirmation, it permanently removes the selected assignment and every scheduled-task record linked to it, including planned, completed, moved, and unplaced sessions.

These two scopes intentionally follow the object selected:

- Selecting a task or session deletes that one task/session.
- Selecting an assignment deletes the assignment and all of its sessions.

## Scheduling consequences

When a planned task is deleted from a future or still-usable slot, that time becomes free immediately. The existing rebalancing priority is reused:

1. Restore sacrificed sleep.
2. Restore before-sleep time.
3. Restore shortened routines.
4. Restore library friend time.
5. Leave the slot blank if nothing needs restoration.

Deleting a completed task removes its record and completion history but does not restore time, because the work already happened. Deleting an assignment applies the same rule to each linked session.

Deleted records disappear from Today, Week, Due, completion percentages, and graphs on the next reload. Completion calculations already derive totals from stored records, so no separate graph deletion is required.

## API and data flow

### Delete one task

`POST /api/tasks` accepts `{ action: "delete", id }`.

The server:

1. Authenticates the request.
2. Loads the exact scheduled task or returns 404.
3. Permanently deletes that row in a transaction.
4. Rebalances its date only when the deleted row was planned and occupied or reserved a usable slot.
5. Leaves any linked assignment and sibling sessions unchanged.

### Delete one assignment

`POST /api/schoolwork` accepts `{ action: "delete", id }`.

The server:

1. Authenticates the request.
2. Loads the exact assignment and linked sessions or returns 404.
3. Permanently deletes every linked scheduled task.
4. Permanently deletes the assignment in the same transaction.
5. Rebalances affected dates for deleted planned sessions.

The operation is transactional so partial deletion cannot leave orphaned schedule state.

## UI state and errors

Deletion is disabled while a request is running. The UI removes the item only after the server confirms success, reloads the affected data, and broadcasts the existing `scheduler:tasks-changed` event so Today, Week, Due, and Stats refresh consistently.

If deletion fails, the item stays visible and an inline error explains that it could not be deleted. Canceling the confirmation changes nothing.

## Testing

Automated tests cover:

- Deleting exactly one independent task.
- Deleting one assignment session without deleting sibling sessions or its assignment.
- Deleting an assignment and all linked session states.
- Removing deleted work from completion totals.
- Restoring sacrificed time after deleting a planned task.
- Not restoring time for a deleted completed task.
- Returning 404 for missing targets.
- Preserving recurring commitments without Delete controls.

Phone and desktop Playwright screenshots cover the Today Delete control, Week editor Delete action, Due assignment Delete action, and confirmation states. No commit, merge, push, or deployment occurs until Hashim approves those screenshots.
