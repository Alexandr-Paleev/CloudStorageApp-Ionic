export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

export const formatDate = (date: string | undefined): string => {
  if (!date) return 'Unknown date';
  try {
    return new Date(date).toLocaleDateString();
  } catch (e) {
    console.error('Date formatting error:', e);
    return 'Invalid date';
  }
};

export const formatDateTime = (date: string | undefined): string => {
  if (!date) return 'Unknown date';
  try {
    return new Date(date).toLocaleString();
  } catch (e) {
    console.error('Date formatting error:', e);
    return 'Invalid date';
  }
};
