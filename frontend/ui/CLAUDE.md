# Frontend UI

React 19 frontend with Vite, Material-UI 7, and TypeScript.

## Directory Structure

```
src/
├── api/              # API client
│   └── client.ts     # apiClient singleton with all endpoints
├── components/       # Reusable components
│   └── __tests__/    # Component tests
├── context/          # React contexts
│   └── __tests__/    # Context tests
├── i18n/             # Internationalization
│   └── locales/      # Translation files (en.json)
├── pages/            # Page components
│   └── __tests__/    # Page tests
├── utils/            # Utility functions
│   └── __tests__/    # Utility tests
├── App.tsx           # Root component with routing
├── main.tsx          # Entry point
└── test-utils.tsx    # Test utilities (custom render)
```

## Commands

```bash
pnpm dev              # Start Vite dev server (port 5173)
pnpm build            # Production build
pnpm lint             # ESLint check
pnpm typecheck        # TypeScript check
pnpm test             # Run Jest tests
pnpm test:coverage    # Tests with coverage report
```

## Component Patterns

### Page Component

Reads go through `useApiQuery`, which wraps TanStack Query around the client's
`{ data, error }` result. Do not hand-roll a `useState` + `useEffect` + `cancelled`
fetch in a new page; several older pages still have one, and they are being converted.

```typescript
export function ExamplePage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();

  const { data, isPending, errorMessage } = useApiQuery(
    queryKeys.thing(id ?? ''),
    () => apiClient.getThing(id!),
    { enabled: Boolean(id) }
  );

  if (isPending) return <CircularProgress />;
  if (errorMessage) return <Alert severity="error">{errorMessage}</Alert>;

  return (
    <Box>
      <Typography variant="h4">{t('page.title')}</Typography>
      {/* Content */}
    </Box>
  );
}
```

Add the key to the `queryKeys` table in `hooks/useApiQuery.ts` rather than writing a key
inline, so a mutation elsewhere can invalidate or overwrite the same entry. After a mutation
that returns the updated record, write it in with `queryClient.setQueryData(key, payload)`;
use `refetch()` when the server does the work asynchronously, as Identify does.

Routes are lazy-loaded in `App.tsx`. A new page is a `lazy(() => import(...))` entry there,
not a static import.

### Form with Edit Tracking

```typescript
function EditForm({ initialData, onSave }: Props) {
  const [formData, setFormData] = useState(initialData);
  const initialRef = useRef(initialData);

  // Reset form when initialData changes (e.g., different item selected)
  if (initialData !== initialRef.current) {
    initialRef.current = initialData;
    setFormData(initialData);
  }

  const hasChanges = JSON.stringify(formData) !== JSON.stringify(initialData);

  return (
    <form>
      {/* Form fields */}
      <Button disabled={!hasChanges} onClick={() => onSave(formData)}>
        Save
      </Button>
    </form>
  );
}
```

### Dialog Component

```typescript
interface DialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, onClose, onConfirm }: DialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t('dialog.title')}</DialogTitle>
      <DialogContent>
        <Typography>{t('dialog.message')}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={onConfirm} color="primary">
          {t('common.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
```

## API Client

All API calls go through `src/api/client.ts`:

```typescript
import { apiClient } from '../api/client';

// GET request
const result = await apiClient.getLibraries();
if (result.error) {
  // Handle error
} else {
  // Use result.data
}

// POST request
const result = await apiClient.createLibrary({
  name: 'Movies',
  path: '/media/movies',
  libraryType: 'Film',
});

// Get image URL (includes auth token)
const url = apiClient.getImageUrl(imageId);

// Get video stream URL
const url = apiClient.getVideoStreamUrl(mediaId, startTime, audioTrack);
```

## Internationalization

All user-facing strings use i18next:

```typescript
import { useTranslation } from 'react-i18next';

function Component() {
  const { t } = useTranslation();

  return (
    <>
      <Typography>{t('page.title')}</Typography>
      <Typography>{t('items.count', { count: 5 })}</Typography>
    </>
  );
}
```

Translation strings are in `src/i18n/locales/en.json`:

```json
{
  "page": {
    "title": "Page Title"
  },
  "items": {
    "count": "{{count}} items",
    "count_one": "{{count}} item"
  }
}
```

## Testing

Tests use Jest + React Testing Library. Test files are colocated in `__tests__/` directories.

### Running Tests

```bash
pnpm test                     # Run all tests
pnpm test -- ComponentName    # Run specific tests
pnpm test -- --watch          # Watch mode
pnpm test:coverage            # With coverage
```

### Test Pattern

```typescript
import { render, screen, waitFor } from '../../test-utils';
import userEvent from '@testing-library/user-event';

describe('ComponentName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly', () => {
    render(<Component />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('handles user interaction', async () => {
    const user = userEvent.setup();
    const onAction = jest.fn();

    render(<Component onAction={onAction} />);

    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onAction).toHaveBeenCalled();
  });

  it('loads data on mount', async () => {
    mockApiClient.getData.mockResolvedValue({
      data: { items: [{ id: '1', name: 'Test' }] },
    });

    render(<Component />);

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeInTheDocument();
    });
  });
});
```

### Custom Test Utilities

Use `test-utils.tsx` for rendering with providers:

```typescript
import { render } from '../../test-utils';

// Automatically wraps with Router, ThemeProvider, etc.
render(<Component />);
```

## ESLint Rules

The project has strict React hooks linting. Common issues:

### useEffect Dependencies

Prefer `useApiQuery` over an effect for fetching. When an effect is genuinely the right tool
(subscriptions, observers), it still needs cancellation:

```typescript
// BAD - calling function directly
useEffect(() => {
  loadData();  // ESLint error
}, []);

// GOOD - inline async with cancellation
useEffect(() => {
  let cancelled = false;
  async function load() {
    const result = await apiClient.getData();
    if (!cancelled) setData(result.data);
  }
  load();
  return () => { cancelled = true; };
}, [dependency]);
```

Setting state inside an effect is linted against (`react-hooks/set-state-in-effect`). To adjust
state when an input changes, do it during render, guarded by a comparison, as
`ActiveLibraryContext` does.

### Form State Reset

```typescript
// BAD - useEffect to reset state
useEffect(() => {
  setFormData(initialData);  // ESLint error
}, [initialData]);

// GOOD - ref pattern
const initialRef = useRef(initialData);
if (initialData !== initialRef.current) {
  initialRef.current = initialData;
  setFormData(initialData);
}
```

### MUI Imports

```typescript
// BAD
import { SelectChangeEvent } from '@mui/material';

// GOOD
import type { SelectChangeEvent } from '@mui/material/Select';
```

## Routing

Routes are defined in `App.tsx` using react-router-dom v6:

```typescript
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route element={<ProtectedRoute />}>
    <Route path="/" element={<Navigate to="/libraries" />} />
    <Route path="/libraries" element={<LibrariesPage />} />
    <Route path="/library/:libraryId" element={<LibraryPage />} />
    <Route path="/collection/:collectionId" element={<CollectionPage />} />
    <Route path="/media/:mediaId" element={<MediaPage />} />
    <Route path="/play/:mediaId" element={<PlayPage />} />
    <Route path="/person/:personId" element={<PersonPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="/users" element={<UsersPage />} />
  </Route>
</Routes>
```

## Contexts

### AuthContext

```typescript
import { useAuth } from '../context/AuthContext';

function Component() {
  const { user, isAuthenticated, login, logout } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  return <div>Welcome, {user.name}</div>;
}
```

### ActiveLibraryContext

```typescript
import { useActiveLibrary } from '../context/ActiveLibraryContext';

function Component() {
  const { activeLibrary, setActiveLibrary, libraries } = useActiveLibrary();

  return (
    <Select value={activeLibrary?.id} onChange={handleChange}>
      {libraries.map(lib => (
        <MenuItem key={lib.id} value={lib.id}>{lib.name}</MenuItem>
      ))}
    </Select>
  );
}
```

## Key Components

| Component | Purpose |
|-----------|---------|
| `Header` | Top navigation bar with library selector |
| `Sidebar` | Navigation drawer |
| `VideoPlayer` | Video playback with trickplay preview |
| `FilmHeroView` | Film detail page hero section |
| `ShowHeroView` | TV show detail page hero section |
| `CastCrewGrid` | Grid of cast/crew members |
| `CollectionBreadcrumbs` | Navigation breadcrumbs |
| `LibraryDialog` | Create/edit library dialog |
| `UserDialog` | Create/edit user dialog |
| `DeleteCollectionDialog` | Confirm collection deletion |
