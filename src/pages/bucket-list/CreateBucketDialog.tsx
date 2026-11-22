import { Loader2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { REGION_MAP } from "./constants";

const regions = Object.entries(REGION_MAP)
  .sort(([codeA, nameA], [codeB, nameB]) =>
    Number(codeA.includes("-")) - Number(codeB.includes("-")) || nameA.localeCompare(nameB, "zh-CN"),
  )
  .map(([code, name]) => ({ value: code, label: `${name} (${code})` }));

export function CreateBucketDialog({
  open,
  onClose,
  bucketName,
  setBucketName,
  bucketRegion,
  setBucketRegion,
  isCreating,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  bucketName: string;
  setBucketName: (v: string) => void;
  bucketRegion: string;
  setBucketRegion: (v: string) => void;
  isCreating: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建存储空间 (Bucket)</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="new-bucket-name">空间名称</Label>
            <Input
              id="new-bucket-name"
              type="text"
              autoFocus
              required
              placeholder="由 3～63 个字符组成，支持小写字母、数字、连字符"
              value={bucketName}
              onChange={(event) => setBucketName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label id="new-bucket-region-label">存储区域</Label>
            <Select
              items={regions}
              value={bucketRegion}
              onValueChange={(value) => { if (value !== null) setBucketRegion(value); }}
            >
              <SelectTrigger aria-labelledby="new-bucket-region-label" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {regions.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={isCreating || !bucketName}>
              {isCreating ? <><Loader2 className="animate-spin" aria-hidden="true" />创建中...</> : "确认创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
