import * as Sentry from '@sentry/react';
import isNil from 'lodash/isNil';
import isUndefined from 'lodash/isUndefined';

import GroupActions from 'app/actions/groupActions';
import {Client, RequestCallbacks, RequestOptions} from 'app/api';
import GroupStore from 'app/stores/groupStore';
import {Actor, Group, Member, Note, User} from 'app/types';
import {buildTeamId, buildUserId} from 'app/utils';
import {uniqueId} from 'app/utils/guid';

type AssignToUserParams = {
  /**
   * Issue id
   */
  id: string;
  user: User | Actor;
  member?: Member;
};

export function assignToUser(params: AssignToUserParams) {
  const api = new Client();

  const endpoint = `/issues/${params.id}/`;

  const id = uniqueId();

  GroupActions.assignTo(id, params.id, {
    email: (params.member && params.member.email) || '',
  });

  const request = api.requestPromise(endpoint, {
    method: 'PUT',
    // Sending an empty value to assignedTo is the same as "clear",
    // so if no member exists, that implies that we want to clear the
    // current assignee.
    data: {
      assignedTo: params.user ? buildUserId(params.user.id) : '',
    },
  });

  request
    .then(data => {
      GroupActions.assignToSuccess(id, params.id, data);
    })
    .catch(data => {
      GroupActions.assignToError(id, params.id, data);
    });

  return request;
}

export function clearAssignment(groupId: string) {
  const api = new Client();

  const endpoint = `/issues/${groupId}/`;

  const id = uniqueId();

  GroupActions.assignTo(id, groupId, {
    email: '',
  });

  const request = api.requestPromise(endpoint, {
    method: 'PUT',
    // Sending an empty value to assignedTo is the same as "clear"
    data: {
      assignedTo: '',
    },
  });

  request
    .then(data => {
      GroupActions.assignToSuccess(id, groupId, data);
    })
    .catch(data => {
      GroupActions.assignToError(id, groupId, data);
    });

  return request;
}

type AssignToActorParams = {
  /**
   * Issue id
   */
  id: string;
  actor: Pick<Actor, 'id' | 'type'>;
};

export function assignToActor({id, actor}: AssignToActorParams) {
  const api = new Client();

  const endpoint = `/issues/${id}/`;

  const guid = uniqueId();
  let actorId;

  GroupActions.assignTo(guid, id, {email: ''});

  switch (actor.type) {
    case 'user':
      actorId = buildUserId(actor.id);
      break;

    case 'team':
      actorId = buildTeamId(actor.id);
      break;

    default:
      Sentry.withScope(scope => {
        scope.setExtra('actor', actor);
        Sentry.captureException('Unknown assignee type');
      });
  }

  return api
    .requestPromise(endpoint, {
      method: 'PUT',
      data: {assignedTo: actorId},
    })
    .then(data => {
      GroupActions.assignToSuccess(guid, id, data);
    })
    .catch(data => {
      GroupActions.assignToError(guid, id, data);
    });
}

export function deleteNote(api: Client, group: Group, id: string, _oldText: string) {
  const restore = group.activity.find(activity => activity.id === id);
  const index = GroupStore.removeActivity(group.id, id);
  if (index === -1) {
    // I dunno, the id wasn't found in the GroupStore
    return Promise.reject(new Error('Group was not found in store'));
  }

  const promise = api.requestPromise(`/issues/${group.id}/comments/${id}/`, {
    method: 'DELETE',
  });

  promise.catch(() => GroupStore.addActivity(group.id, restore, index));

  return promise;
}

export function createNote(api: Client, group: Group, note: Note) {
  const promise = api.requestPromise(`/issues/${group.id}/comments/`, {
    method: 'POST',
    data: note,
  });

  promise.then(data => GroupStore.addActivity(group.id, data));

  return promise;
}

export function updateNote(
  api: Client,
  group: Group,
  note: Note,
  id: string,
  oldText: string
) {
  GroupStore.updateActivity(group.id, id, {text: note.text});

  const promise = api.requestPromise(`/issues/${group.id}/comments/${id}/`, {
    method: 'PUT',
    data: note,
  });

  promise.catch(() => GroupStore.updateActivity(group.id, id, {text: oldText}));

  return promise;
}

type ParamsType = {
  itemIds?: Array<number> | Array<string>;
  query?: string;
  environment?: string | Array<string> | null;
  project?: Array<number> | null;
};

type QueryArgs =
  | {
      query: string;
      environment?: string | Array<string>;
      project?: Array<number>;
    }
  | {
      id: Array<number> | Array<string>;
      environment?: string | Array<string>;
      project?: Array<number>;
    }
  | {
      environment?: string | Array<string>;
      project?: Array<number>;
    };

/**
 * Converts input parameters to API-compatible query arguments
 */
export function paramsToQueryArgs(params: ParamsType): QueryArgs {
  const p: QueryArgs = params.itemIds
    ? {id: params.itemIds} // items matching array of itemids
    : params.query
    ? {query: params.query} // items matching search query
    : {}; // all items

  // only include environment if it is not null/undefined
  if (params.query && !isNil(params.environment)) {
    p.environment = params.environment;
  }

  // only include projects if it is not null/undefined/an empty array
  if (params.project && params.project.length) {
    p.project = params.project;
  }

  // only include date filters if they are not null/undefined
  if (params.query) {
    ['start', 'end', 'period', 'utc'].forEach(prop => {
      if (!isNil(params[prop])) {
        p[prop === 'period' ? 'statsPeriod' : prop] = params[prop];
      }
    });
  }
  return p;
}

function chainUtil<Args extends any[]>(
  ...funcs: Array<((...args: Args) => any) | undefined>
) {
  const filteredFuncs = funcs.filter(
    (f): f is (...args: Args) => any => typeof f === 'function'
  );
  return (...args: Args): void => {
    filteredFuncs.forEach(func => {
      func.apply(funcs, args);
    });
  };
}

function wrapRequest(
  api: Client,
  path: string,
  options: RequestOptions,
  extraParams: RequestCallbacks
) {
  if (isUndefined(extraParams)) {
    extraParams = {};
  }

  options.success = chainUtil(options.success, extraParams.success);
  options.error = chainUtil(options.error, extraParams.error);
  options.complete = chainUtil(options.complete, extraParams.complete);

  return api.request(path, options);
}

type BulkDeleteParams = ParamsType & {
  orgId: string;
  projectId?: string;
};

export function bulkDelete(
  api: Client,
  params: BulkDeleteParams,
  options: RequestCallbacks
) {
  const path: string = params.projectId
    ? `/projects/${params.orgId}/${params.projectId}/issues/`
    : `/organizations/${params.orgId}/issues/`;

  const query: QueryArgs = paramsToQueryArgs(params);
  const id: string = uniqueId();

  GroupActions.delete(id, params.itemIds);

  return wrapRequest(
    api,
    path,
    {
      query,
      method: 'DELETE',
      success: response => {
        GroupActions.deleteSuccess(id, params.itemIds, response);
      },
      error: error => {
        GroupActions.deleteError(id, params.itemIds, error);
      },
    },
    options
  );
}

type BulkUpdateParams = ParamsType & {
  orgId: string;
  projectId?: string;
  failSilently?: boolean;
  data?: any;
};

export function bulkUpdate(
  api: Client,
  params: BulkUpdateParams,
  options: RequestCallbacks
) {
  const path: string = params.projectId
    ? `/projects/${params.orgId}/${params.projectId}/issues/`
    : `/organizations/${params.orgId}/issues/`;

  const query: QueryArgs = paramsToQueryArgs(params);
  const id: string = uniqueId();

  GroupActions.update(id, params.itemIds, params.data);

  return wrapRequest(
    api,
    path,
    {
      query,
      method: 'PUT',
      data: params.data,
      success: response => {
        GroupActions.updateSuccess(id, params.itemIds, response);
      },
      error: error => {
        GroupActions.updateError(id, params.itemIds, error, params.failSilently);
      },
    },
    options
  );
}

type MergeGroupsParams = ParamsType & {
  orgId: string;
  projectId?: string;
};

export function mergeGroups(
  api: Client,
  params: MergeGroupsParams,
  options: RequestCallbacks
) {
  const path: string = params.projectId
    ? `/projects/${params.orgId}/${params.projectId}/issues/`
    : `/organizations/${params.orgId}/issues/`;

  const query: QueryArgs = paramsToQueryArgs(params);
  const id: string = uniqueId();

  GroupActions.merge(id, params.itemIds);

  return wrapRequest(
    api,
    path,
    {
      query,
      method: 'PUT',
      data: {merge: 1},
      success: response => {
        GroupActions.mergeSuccess(id, params.itemIds, response);
      },
      error: error => {
        GroupActions.mergeError(id, params.itemIds, error);
      },
    },
    options
  );
}
