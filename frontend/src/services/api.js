import axios from "axios";
import { supabase } from "./supabase";
import {
  apiQueryKey,
  getApiCacheScope,
  invalidateApiCache,
  queryClient,
  shouldCacheGet,
  staleTimeFor,
} from "./queryClient";
import { captureSupportFailure } from "./supportCapture";
import { requestCaseLifecycleInput } from "./caseLifecycleGate";
import { requestRequiredCaseTeam } from "./caseRequiredTeamGate";

const transport = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5001/api",
  timeout: 30000,
});

transport.interceptors.request.use(async (config) => {
  if (!supabase) return config;
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) config.headers.Authorization = `Bearer ${data.session.access_token}`;
  return config;
});

transport.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    if (!error.config?.url?.startsWith("/support") && (!status || status >= 500)) {
      void captureSupportFailure({
        code: error.response?.data?.code || "REQUEST_FAILED",
        message: error.response?.data?.message || error.message,
        requestId: error.response?.data?.requestId || error.response?.headers?.["x-request-id"],
        status,
        notify: false,
      });
    }
    return Promise.reject(error);
  },
);

async function cachedGet(url, config = {}) {
  if (!shouldCacheGet(url, config)) return transport.get(url, config);
  const scope = getApiCacheScope();
  return queryClient.ensureQueryData({
    queryKey: apiQueryKey(scope, url, config),
    queryFn: ({ signal }) => transport.get(url, { ...config, signal }),
    staleTime: staleTimeFor(url),
    revalidateIfStale: true,
  });
}

async function freshGet(url, config = {}) {
  if (!shouldCacheGet(url, config)) return transport.get(url, config);
  const scope = getApiCacheScope();
  const queryKey = apiQueryKey(scope, url, config);
  queryClient.removeQueries({ queryKey, exact: true });
  return queryClient.fetchQuery({
    queryKey,
    queryFn: ({ signal }) => transport.get(url, { ...config, signal }),
    staleTime: staleTimeFor(url),
  });
}

function caseLifecycleTarget(method, url, data) {
  if (method !== "patch" || !data || !["Submitted", "Decision Received"].includes(data.stage)) return null;
  const match = /^\/cases\/([^/?#]+)$/.exec(String(url || ""));
  if (!match) return null;
  return { caseId: decodeURIComponent(match[1]), stage: data.stage };
}

function apiDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function lifecycleChanged(current, data, stage) {
  if (current?.stage !== stage) return true;
  if (!current?.submittedAt) return true;
  if (data.submittedAt && apiDate(data.submittedAt) !== apiDate(current.submittedAt)) return true;
  if (stage === "Decision Received") {
    if (!current?.decision) return true;
    if (data.decisionAt && apiDate(data.decisionAt) !== apiDate(current.decisionAt)) return true;
  }
  return false;
}

async function mutateCaseLifecycle(url, data, config, target) {
  const [currentResponse, caseTypesResponse] = await Promise.all([
    transport.get(`${url}/lifecycle`),
    transport.get("/cases/case-types"),
  ]);
  const current = currentResponse.data?.data || null;

  if (!lifecycleChanged(current, data, target.stage)) {
    return transport.patch(url, data, config);
  }

  const lifecycleInput = await requestCaseLifecycleInput({
    caseId: target.caseId,
    stage: target.stage,
    current,
    payload: data,
    caseTypes: caseTypesResponse.data?.data || [],
  });

  const regularData = { ...data };
  delete regularData.stage;
  delete regularData.submittedAt;
  delete regularData.decisionAt;
  delete regularData.decisionOutcome;
  delete regularData.permitExpiryAt;
  delete regularData.refusalResolution;
  delete regularData.newCaseType;
  delete regularData.nextAction;

  if (Object.keys(regularData).length) {
    await transport.patch(url, regularData, config);
  }

  const lifecycleResponse = await transport.patch(`${url}/lifecycle`, {
    stage: target.stage,
    nextAction: data.nextAction,
    ...lifecycleInput,
  }, config);

  if (lifecycleResponse.data?.lifecycle?.requiresClose) {
    const successor = lifecycleResponse.data.lifecycle.successorCase || null;
    const reason = successor
      ? `Application refused; original file closed after successor ${successor.caseType} case was created.`
      : "Application refused; file permanently closed after decision review.";
    const closeResponse = await transport.patch(`${url}/close`, {
      billingDisposition: "keep_outstanding",
      billingReason: reason,
    }, config);
    closeResponse.data = {
      ...closeResponse.data,
      lifecycle: lifecycleResponse.data.lifecycle,
    };
    return closeResponse;
  }

  return lifecycleResponse;
}

async function mutateCaseCreate(url, data, config) {
  if (data?.rcicUserId && data?.caseWorkerUserId) {
    return transport.post(url, data, config);
  }

  const requests = [transport.get("/cases/collaboration-options")];
  if (data?.clientId) {
    requests.push(transport.get(`/clients/${encodeURIComponent(data.clientId)}`).catch(() => null));
  }
  const [optionsResponse, clientResponse] = await Promise.all(requests);
  const options = optionsResponse.data?.data || {};
  const clientData = clientResponse?.data?.data;
  const clientName = clientData?.client?.fullName || clientData?.fullName || "Client";
  const team = await requestRequiredCaseTeam({
    options,
    payload: data,
    clientName,
  });

  return transport.post(url, {
    ...data,
    ...team,
    assignedUserId: team.caseWorkerUserId,
  }, config);
}

async function mutate(method, url, data, config) {
  const scope = getApiCacheScope();
  const lifecycleTarget = caseLifecycleTarget(method, url, data);
  const isCaseCreate = method === "post" && String(url || "") === "/cases";
  const response = lifecycleTarget
    ? await mutateCaseLifecycle(url, data, config, lifecycleTarget)
    : isCaseCreate
      ? await mutateCaseCreate(url, data, config)
      : method === "delete"
        ? await transport.delete(url, config)
        : await transport[method](url, data, config);
  invalidateApiCache(url, scope);
  return response;
}

const api = {
  get: cachedGet,
  getFresh: freshGet,
  post: (url, data, config) => mutate("post", url, data, config),
  put: (url, data, config) => mutate("put", url, data, config),
  patch: (url, data, config) => mutate("patch", url, data, config),
  delete: (url, config) => mutate("delete", url, undefined, config),
  request: (config) => transport.request(config),
  defaults: transport.defaults,
  interceptors: transport.interceptors,
};

export default api;
