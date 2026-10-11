import { definePlugin, icons, gradients, places } from '$kernel/api';
import type { PluginContext, PromptContext, Place } from '$kernel/api';
import Weather from './Weather.svelte';
import { fetchWeather, promptLine, forecastText, type Weather as WeatherData } from './lookup';

/**
 * 天气：你那边、他那边的真实天气，照时区那套——他没选城市就和你一个地方。
 * 只在这局的钟和真实时间对齐时给（跳过了、停表的局由模型按剧情编）。一句话进最后一条用户消息，system 不动。
 * 数据来源 Open-Meteo，浏览器直接请求，不花 token；查不到就沉默。设计见 designs/weather.md。
 */
let ctx: PluginContext;

export interface Pair { mine: WeatherData | null; yours: WeatherData | null; sameplace: boolean; his?: Place; yoursPlace: Place }

export const weatherApi = {
  ctx: () => ctx,
  /** 这局两边的天气：他那边（没选城市就和你一样）和你那边。同一个地方只查一次 */
  async pair(characterId: string | undefined, force = false): Promise<Pair> {
    const [ch, yoursPlace] = await Promise.all([characterId ? ctx.data.character(characterId) : undefined, ctx.data.userPlace()]);
    const his = ch?.place;
    const sameplace = !his || places.samePlace(his, yoursPlace);
    const yours = await fetchWeather(yoursPlace, fetch, Date.now(), force);
    const mine = sameplace ? yours : await fetchWeather(his!, fetch, Date.now(), force);
    return { mine, yours, sameplace, his, yoursPlace };
  },
  /** 进提示词的一句；钟没对齐、查不到都返回空串 */
  async line(campaignId: string, characterId: string): Promise<string> {
    const cp = await ctx.data.campaign(campaignId);
    if (!cp || !cp.aligned) return '';
    const p = await this.pair(characterId);
    return p.sameplace ? promptLine(p.mine, null) : promptLine(p.mine, p.yours);
  },
};

export default definePlugin({
  id: 'weather',
  name: '天气',
  version: '0.1.0',
  description: '你那边、他那边的真实天气。他出远门时在角色卡上选城市；钟和真实时间对齐的局，他会知道今天什么天气。',
  app: { screen: Weather, icon: { paths: icons.weather, background: gradients.blue } },
  services: { weather: {
    /** 这局的天气一句（他那边 / 你那边），没有就空串 */
    line: (campaignId: string, characterId: string) => weatherApi.line(campaignId, characterId),
  } },
  promptContributors: [{
    id: 'now',
    volatile: (p: PromptContext) => weatherApi.line(p.campaignId, p.characterIds[0]!),
  }],
  tools: [{
    name: 'weather_forecast',
    label: '看天气',
    description: '看未来几天的天气预报（今天起最多 7 天）。默认看你自己那边；whose 填 you 看对方那边（你们在同一个地方时一样）。只有这局的时间和真实时间对齐时才有真实天气，没有就按剧情说。',
    inputSchema: { type: 'object', properties: { whose: { type: 'string', enum: ['me', 'you'], description: 'me＝你那边（默认），you＝对方那边' }, days: { type: 'integer', minimum: 1, maximum: 7 } } },
    async handler(input: unknown, p: PromptContext) {
      const { whose, days } = (input ?? {}) as { whose?: string; days?: number };
      const cp = await ctx.data.campaign(p.campaignId);
      if (!cp?.aligned) return '这局的时间和真实时间对不上，没有真实天气，按剧情说。';
      const pair = await weatherApi.pair(p.characterIds[0]);
      const w = whose === 'you' ? pair.yours : pair.mine;
      if (!w) return '现在查不到天气（没网或接口不通），别编具体数字。';
      return forecastText(w, days ?? 7);
    },
  }],
  setup(c) { ctx = c; },
});
