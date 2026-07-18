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

async function mutate(method, url, data, config) {
  const scope = getApiCacheScope();
  const response = method === "delete"
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
