import type { Application } from './Application';
import type { Plugin } from './Plugin';
import { getPlugins } from './utils/remotePlugins';

export type PluginOptions<T = any> = { name?: string; config?: T };
export type PluginType<Opts = any> = typeof Plugin | [typeof Plugin, PluginOptions<Opts>];
export type PluginData = {
  name: string;
  packageName: string;
  version: string;
  url: string;
  type: 'local' | 'upload' | 'npm';
};

export class PluginManager {
  protected pluginInstances: Map<typeof Plugin, Plugin> = new Map();
  protected pluginsAliases: Record<string, Plugin> = {};
  private initPlugins: Promise<void>;

  constructor(
    protected _plugins: PluginType[],
    protected app: Application,
  ) {
    this.app = app;
    this.initPlugins = this.init(_plugins);
  }

  async init(_plugins: PluginType[]) {
    await this.initStaticPlugins(_plugins);
    await this.initRemotePlugins();
  }

  private async initStaticPlugins(_plugins: PluginType[] = []) {
    for await (const plugin of _plugins) {
      const pluginClass = Array.isArray(plugin) ? plugin[0] : plugin;
      const opts = Array.isArray(plugin) ? plugin[1] : undefined;
      await this.add(pluginClass, opts);
    }
  }

  private async initRemotePlugins() {
    try {
      const res = await this.app.apiClient.request({ url: 'app:getPlugins' });
      const pluginList: PluginData[] = res.data?.data || [];
      const plugins = await getPlugins({
        requirejs: this.app.requirejs,
        pluginData: pluginList,
        baseURL: this.app.apiClient.axios?.defaults?.baseURL,
        devDynamicImport: this.app.devDynamicImport,
      });
      for await (const plugin of plugins) {
        await this.add(plugin);
      }
    } catch (error) {
      if (401 === error?.response?.status) {
        this.app.apiClient.auth.setRole(null);
        window.location.reload();
      } else {
        throw error;
      }
    }
  }

  async add<T = any>(plugin: typeof Plugin, opts: PluginOptions<T> = {}) {
    const instance = this.getInstance(plugin, opts);

    this.pluginInstances.set(plugin, instance);

    if (opts.name) {
      this.pluginsAliases[opts.name] = instance;
    }
    await instance.afterAdd();
  }

  get<T extends typeof Plugin>(PluginClass: T): InstanceType<T>;
  get<T extends {}>(name: string): T;
  get(name: any) {
    if (typeof name === 'string') {
      return this.pluginsAliases[name];
    }
    return this.pluginInstances.get(name);
  }

  private getInstance<T>(plugin: typeof Plugin, opts?: T) {
    return new plugin(opts, this.app);
  }

  async load() {
    await this.initPlugins;

    for (const plugin of this.pluginInstances.values()) {
      await plugin.beforeLoad();
    }

    for (const plugin of this.pluginInstances.values()) {
      await plugin.load();
    }
  }
}
