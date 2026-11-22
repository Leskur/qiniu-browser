import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function DeleteBucketDialog({
  bucketName,
  confirmInput,
  setConfirmInput,
  onConfirm,
  onCancel,
}: {
  bucketName: string | null;
  confirmInput: string;
  setConfirmInput: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={Boolean(bucketName)} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认删除空间？</DialogTitle>
          <DialogDescription className="break-all">
            删除后该空间内所有文件将永久丢失，且无法恢复。请输入空间名称 <strong className="select-all text-destructive">{bucketName}</strong> 以确认。
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => {
          event.preventDefault();
          if (bucketName && confirmInput === bucketName) onConfirm();
        }}>
          <Input autoFocus value={confirmInput} placeholder={bucketName ?? undefined}
            aria-label="确认空间名称" onChange={(event) => setConfirmInput(event.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
            <Button type="submit" variant="destructive" disabled={!bucketName || confirmInput !== bucketName}>
              确认删除，不可恢复
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
