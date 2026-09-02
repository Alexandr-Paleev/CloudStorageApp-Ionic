import {
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSelect,
  IonSelectOption,
} from '@ionic/react';
import {
  SORT_OPTIONS,
  TYPE_GROUPS,
  type SortDirection,
  type SortField,
  type TypeGroup,
} from '../utils/file-query';

export interface FileFiltersValue {
  search: string;
  sort: SortField;
  direction: SortDirection;
  group: TypeGroup;
}

interface FileFiltersProps {
  value: FileFiltersValue;
  onChange: (value: FileFiltersValue) => void;
  /** Shown next to the controls once a search is running. */
  resultCount?: number;
}

/** One string per ordering, because IonSelect carries a value, not a pair. */
const keyOf = (sort: SortField, direction: SortDirection) => `${sort}:${direction}`;

/**
 * Finding a file among a hundred.
 *
 * Every control here changes the query rather than the rendered list: the
 * dashboard loads fifteen rows at a time, so a filter applied in the browser
 * would search the page you happen to be looking at.
 */
const FileFilters: React.FC<FileFiltersProps> = ({ value, onChange, resultCount }) => {
  const searching = value.search.trim().length > 0;

  return (
    <div className="file-filters">
      <IonSearchbar
        value={value.search}
        placeholder="Search files"
        /* Typing sends a query per keystroke otherwise, and each one is a round
           trip that the next keystroke makes pointless. */
        debounce={300}
        onIonInput={(e) => onChange({ ...value, search: e.detail.value ?? '' })}
        data-testid="file-search"
      />

      <div className="file-filters-row">
        <IonSegment
          value={value.group}
          onIonChange={(e) => onChange({ ...value, group: e.detail.value as TypeGroup })}
        >
          {TYPE_GROUPS.map((group) => (
            <IonSegmentButton key={group.value} value={group.value}>
              <IonLabel>{group.label}</IonLabel>
            </IonSegmentButton>
          ))}
        </IonSegment>

        <IonSelect
          value={keyOf(value.sort, value.direction)}
          interface="popover"
          aria-label="Sort files"
          onIonChange={(e) => {
            const [sort, direction] = (e.detail.value as string).split(':');
            onChange({ ...value, sort: sort as SortField, direction: direction as SortDirection });
          }}
        >
          {SORT_OPTIONS.map((option) => (
            <IonSelectOption
              key={keyOf(option.field, option.direction)}
              value={keyOf(option.field, option.direction)}
            >
              {option.label}
            </IonSelectOption>
          ))}
        </IonSelect>
      </div>

      {searching && (
        /* Said out loud because the scope changes: a search looks in every
           folder, not only the one on screen. */
        <IonLabel className="file-filters-note" color="medium">
          {resultCount === 0
            ? `No files match “${value.search.trim()}” anywhere in your storage`
            : `Searching every folder${resultCount === undefined ? '' : ` — ${resultCount} so far`}`}
        </IonLabel>
      )}
    </div>
  );
};

export default FileFilters;
