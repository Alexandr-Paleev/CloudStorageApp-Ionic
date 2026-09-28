import {
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSelect,
  IonSelectOption,
} from '@ionic/react';
import { smartSearchIsOffered } from '../utils/smart-search.utils';
import {
  SORT_OPTIONS,
  TYPE_GROUPS,
  type SortDirection,
  type SortField,
  type TypeGroup,
} from '../utils/file-query';

/**
 * How the search term is read.
 *
 * `name` matches the text against the file name. `smart` matches what the
 * file is *about*, against the description a model wrote when it was indexed
 * — the mode that finds a photograph the camera called IMG_4821.jpg.
 */
export type SearchMode = 'name' | 'smart';

export interface FileFiltersValue {
  search: string;
  sort: SortField;
  direction: SortDirection;
  group: TypeGroup;
  mode: SearchMode;
}

interface FileFiltersProps {
  value: FileFiltersValue;
  onChange: (value: FileFiltersValue) => void;
  /** Shown next to the controls once a search is running. */
  resultCount?: number;
  /** The search errored, so there is no result to describe. */
  searchFailed?: boolean;
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
const FileFilters: React.FC<FileFiltersProps> = ({
  value,
  onChange,
  resultCount,
  searchFailed,
}) => {
  const searching = value.search.trim().length > 0;
  /* A switch that cannot work should not be on screen: without a model
     provider the route answers 501, and the only honest thing to show would
     be an error. Deployments without keys — which is every fresh clone —
     keep the search they always had. */
  const offerSmart = smartSearchIsOffered();

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

      {searching && offerSmart && (
        /* Offered once there is something to search for, rather than sitting
           in the toolbar all the time: the choice only means anything after a
           term is typed, and that is also the moment it explains itself. */
        <IonSegment
          className="file-filters-mode"
          data-testid="search-mode"
          value={value.mode}
          onIonChange={(e) => onChange({ ...value, mode: e.detail.value as SearchMode })}
        >
          <IonSegmentButton value="name">
            <IonLabel>By name</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="smart">
            <IonLabel>By meaning</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      )}

      {searching && !searchFailed && (
        /* Said out loud because the scope changes: a search looks in every
           folder, not only the one on screen. In the smart mode the scope is
           narrower in a different way — only indexed files can be found — and
           a person who is not told that reads an empty list as a broken one. */
        <IonLabel className="file-filters-note" color="medium">
          {value.mode === 'smart'
            ? resultCount === 0
              ? `Nothing indexed matches “${value.search.trim()}” — files are indexed after upload`
              : `Closest in meaning, every folder${resultCount === undefined ? '' : ` — ${resultCount}`}`
            : resultCount === 0
              ? `No files match “${value.search.trim()}” anywhere in your storage`
              : `Searching every folder${resultCount === undefined ? '' : ` — ${resultCount} so far`}`}
        </IonLabel>
      )}
    </div>
  );
};

export default FileFilters;
