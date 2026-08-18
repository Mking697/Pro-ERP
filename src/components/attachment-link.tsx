export default function AttachmentLink({ url }: { url: string }) {
  if (!url) return <span className="text-muted-foreground">—</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
      View
    </a>
  );
}
