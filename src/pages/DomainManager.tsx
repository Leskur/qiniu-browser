import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { fetchCdnDomains, CdnDomain } from "../lib/qiniu";
import { RefreshCw, Globe, Copy, Check, ExternalLink, ArrowUpDown, ArrowUp, ArrowDown, Search, X, Zap, Info, Calendar, Server } from "lucide-react";
import { Skeleton } from "../components/ui/skeleton";

type SortField = 'name' | 'status' | 'protocol' | 'geoCover';
type SortDirection = 'asc' | 'desc';

export function DomainManager({ 
  ak, 
  sk,
  selectedDomain,
  onSelectDomain,
  onRefreshDomain,
  refreshTrigger
}: { 
  ak: string; 
  sk: string;
  selectedDomain: string | null;
  onSelectDomain: (domain: string | null) => void;
  onRefreshDomain: (domain: string) => void;
  refreshTrigger?: number;
}) {
  const [domains, setDomains] = useState<CdnDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedCname, setCopiedCname] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchQuery, setSearchQuery] = useState("");

  const loadDomains = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      // 获取所有域名（处理分页）
      let allDomains: CdnDomain[] = [];
      let marker = "";
      
      do {
        const result = await fetchCdnDomains(ak, sk, marker, 100);
        allDomains = [...allDomains, ...result.domains];
        marker = result.marker;
      } while (marker);

      setDomains(allDomains);
    } catch (err: any) {
      toast.error("加载域名列表失败", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDomains();
  }, [ak, sk]);

  // ── F5 刷新触发 ──
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      handleRefresh();
    }
  }, [refreshTrigger]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadDomains(false);
    setRefreshing(false);
    toast.success("刷新成功");
  };

  const handleCopyCname = (cname: string) => {
    navigator.clipboard.writeText(cname).then(() => {
      setCopiedCname(cname);
      setTimeout(() => setCopiedCname(null), 2000);
    }).catch(() => {
      toast.error("复制失败");
    });
  };

  const getStatusBadge = (state: string) => {
    switch (state) {
      case "success":
        return <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">在线</span>;
      case "offline":
        return <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">离线</span>;
      case "processing":
        return <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">配置中</span>;
      case "failed":
        return <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">失败</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">{state}</span>;
    }
  };

  const getGeoCoverText = (geoCover: string) => {
    switch (geoCover) {
      case "china": return "国内";
      case "overseas": return "海外";
      case "global": return "全球";
      default: return geoCover;
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1" /> 
      : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const sortedDomains = useMemo(() => {
    return [...domains].sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'status':
          comparison = a.operatingState.localeCompare(b.operatingState);
          break;
        case 'protocol':
          comparison = a.protocol.localeCompare(b.protocol);
          break;
        case 'geoCover':
          comparison = a.geoCover.localeCompare(b.geoCover);
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [domains, sortField, sortDirection]);

  const filteredDomains = useMemo(() => {
    if (!searchQuery.trim()) return sortedDomains;
    
    const query = searchQuery.toLowerCase();
    return sortedDomains.filter(domain => 
      domain.name.toLowerCase().includes(query) ||
      domain.cname.toLowerCase().includes(query) ||
      domain.operatingState.toLowerCase().includes(query)
    );
  }, [sortedDomains, searchQuery]);

  const selectedDomainData = useMemo(() => {
    return domains.find(d => d.name === selectedDomain);
  }, [domains, selectedDomain]);

  const formatDate = (timestamp?: number | string) => {
    if (!timestamp) return "未知";
    try {
      // 如果是字符串，尝试解析
      const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp * 1000);
      if (isNaN(date.getTime())) return "未知";
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch {
      return "未知";
    }
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-zinc-200 dark:border-zinc-800 shrink-0 bg-white/80 dark:bg-zinc-900/60 backdrop-blur-sm z-20">
        <div className="flex items-center gap-3">
          <Globe className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-200">域名管理</h2>
          {!loading && (
            <span className="text-xs text-zinc-400">
              {searchQuery ? `${filteredDomains.length} / ${domains.length}` : `共 ${domains.length} 个域名`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索域名或 CNAME..."
              className="pl-9 pr-8 py-1.5 text-sm bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400 w-64"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-4 p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : domains.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Globe className="w-16 h-16 text-zinc-300 dark:text-zinc-700 mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400 mb-2">暂无 CDN 域名</p>
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              请前往七牛云控制台添加 CDN 加速域名
            </p>
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <table className="w-full">
              <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700 sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                    <button
                      onClick={() => handleSort('name')}
                      className="flex items-center hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                    >
                      域名
                      <SortIcon field="name" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap w-24">
                    <button
                      onClick={() => handleSort('status')}
                      className="flex items-center hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                    >
                      状态
                      <SortIcon field="status" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap w-20">
                    <button
                      onClick={() => handleSort('protocol')}
                      className="flex items-center hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                    >
                      协议
                      <SortIcon field="protocol" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap w-24">
                    <button
                      onClick={() => handleSort('geoCover')}
                      className="flex items-center hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                    >
                      加速区域
                      <SortIcon field="geoCover" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap">CNAME</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-nowrap w-24">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-950">
                {filteredDomains.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
                        <Search className="w-12 h-12 mb-3 opacity-50" />
                        <p className="text-sm">没有找到匹配的域名</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredDomains.map(domain => (
                    <tr key={domain.name} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onSelectDomain(domain.name)}
                          className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:underline text-left"
                        >
                          {domain.name}
                        </button>
                        {domain.type === "pan" && (
                          <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 whitespace-nowrap">
                            泛域名
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 w-24">
                      {getStatusBadge(domain.operatingState)}
                    </td>
                    <td className="px-4 py-3 w-20">
                      <span className={`text-xs font-medium whitespace-nowrap ${domain.protocol === 'https' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                        {domain.protocol.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 w-24">
                      <span className="text-sm text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                        {getGeoCoverText(domain.geoCover)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-xs font-mono text-zinc-600 dark:text-zinc-400">
                        {domain.cname}
                      </code>
                    </td>
                    <td className="px-4 py-3 w-24">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onRefreshDomain(domain.name)}
                          className="p-1.5 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                          title="刷新该域名"
                        >
                          <Zap className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleCopyCname(domain.cname)}
                          className="p-1.5 text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded transition-colors"
                          title="复制 CNAME"
                        >
                          {copiedCname === domain.cname ? (
                            <Check className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                        <a
                          href={`${domain.protocol}://${domain.name}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded transition-colors"
                          title="访问域名"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Domain Detail Panel */}
      {selectedDomainData && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-30"
            onClick={() => onSelectDomain(null)}
          />
          
          {/* Panel */}
          <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl z-40 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">域名详情</h3>
              </div>
              <button
                onClick={() => onSelectDomain(null)}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Domain Name */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    {selectedDomainData.name}
                  </h4>
                  {selectedDomainData.type === "pan" && (
                    <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                      泛域名
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {getStatusBadge(selectedDomainData.operatingState)}
                  <span className="text-xs text-zinc-400">·</span>
                  <span className={`text-xs font-medium ${selectedDomainData.protocol === 'https' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                    {selectedDomainData.protocol.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    onRefreshDomain(selectedDomainData.name);
                    onSelectDomain(null);
                  }}
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-lg transition-colors font-medium text-sm"
                >
                  <Zap className="w-4 h-4" />
                  刷新缓存
                </button>
                <a
                  href={`${selectedDomainData.protocol}://${selectedDomainData.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 px-4 py-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 rounded-lg transition-colors font-medium text-sm"
                >
                  <ExternalLink className="w-4 h-4" />
                  访问域名
                </a>
              </div>

              {/* Basic Info */}
              <div className="space-y-4">
                <h5 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  基本信息
                </h5>
                
                <div className="space-y-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">加速区域</span>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {getGeoCoverText(selectedDomainData.geoCover)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-start">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">域名类型</span>
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {selectedDomainData.type === "pan" ? "泛域名" : "普通域名"}
                    </span>
                  </div>

                  {selectedDomainData.createAt && (
                    <div className="flex justify-between items-start">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        创建时间
                      </span>
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {formatDate(selectedDomainData.createAt)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* CNAME Configuration */}
              <div className="space-y-4">
                <h5 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                  <Server className="w-4 h-4" />
                  CNAME 配置
                </h5>
                
                <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 space-y-3">
                  <div>
                    <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-2 block">CNAME 记录值</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded text-xs font-mono text-zinc-700 dark:text-zinc-300 break-all">
                        {selectedDomainData.cname}
                      </code>
                      <button
                        onClick={() => handleCopyCname(selectedDomainData.cname)}
                        className="p-2 text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded transition-colors shrink-0"
                        title="复制"
                      >
                        {copiedCname === selectedDomainData.cname ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                    <p className="font-medium">配置步骤：</p>
                    <ol className="list-decimal list-inside space-y-1 pl-2">
                      <li>登录您的域名服务商管理后台</li>
                      <li>添加 CNAME 记录，指向上方的记录值</li>
                      <li>等待 DNS 解析生效（通常 10 分钟内）</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
              <button
                onClick={() => onSelectDomain(null)}
                className="w-full px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors font-medium text-sm"
              >
                关闭
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
