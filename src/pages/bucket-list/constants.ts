export type SortField = 'tbl' | 'region' | 'file_num' | 'storage_size' | 'ctime';

export const REGION_MAP: Record<string, string> = {
  'z0': '华东',
  'cn-east-1': '华东',
  'z1': '华北',
  'cn-north-1': '华北',
  'z2': '华南-广东',
  'cn-south-1': '华南-广东',
  'na0': '北美',
  'us-north-1': '北美',
  'as0': '亚太-新加坡（原东南亚）',
  'ap-southeast-1': '亚太-新加坡（原东南亚）',
  'cn-east-2': '华东-浙江2',
  'fog-cn-east-1': '华东-雾存储'
};

export function formatRegion(regionCode: string) {
  return REGION_MAP[regionCode] || regionCode;
}
