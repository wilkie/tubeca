import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Box,
  Chip,
  OutlinedInput,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import {
  apiClient,
  type User,
  type UserRole,
  type Group,
} from '../api/client';

interface UserDialogProps {
  open: boolean;
  user: User | null;
  groups: Group[];
  onClose: () => void;
  onSave: () => void;
}

const ROLES: UserRole[] = ['Admin', 'Editor', 'Viewer'];

export function UserDialog({ open, user, groups, onClose, onSave }: UserDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('Viewer');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const lastUserIdRef = useRef<string | null>(null);

  const isEditing = !!user;

  // Reset form when user changes
  const currentUserId = user?.id ?? null;
  if (currentUserId !== lastUserIdRef.current) {
    lastUserIdRef.current = currentUserId;
    if (user) {
      setName(user.name);
      setPassword('');
      setRole(user.role);
      setSelectedGroupIds(user.groups.map((g) => g.id));
    } else {
      setName('');
      setPassword('');
      setRole('Viewer');
      setSelectedGroupIds([]);
    }
    setError(null);
  }

  const handleGroupChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    setSelectedGroupIds(typeof value === 'string' ? value.split(',') : value);
  };

  const handleSubmit = async () => {
    setError(null);

    if (!name.trim()) {
      setError(t('users.validation.nameRequired'));
      return;
    }

    if (!isEditing && !password.trim()) {
      setError(t('users.validation.passwordRequired'));
      return;
    }

    setIsSaving(true);

    if (isEditing) {
      // Update role and groups separately
      const roleResult = await apiClient.updateUserRole(user.id, role);
      if (roleResult.error) {
        setError(roleResult.error);
        setIsSaving(false);
        return;
      }

      const groupsResult = await apiClient.updateUserGroups(user.id, selectedGroupIds);
      if (groupsResult.error) {
        setError(groupsResult.error);
        setIsSaving(false);
        return;
      }

      setIsSaving(false);
      onSave();
    } else {
      // Create new user
      const result = await apiClient.createUser({
        name: name.trim(),
        password: password.trim(),
        role,
        groupIds: selectedGroupIds,
      });

      setIsSaving(false);

      if (result.error) {
        setError(result.error);
      } else {
        onSave();
      }
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isEditing ? t('users.edit') : t('users.create')}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label={t('users.username')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            autoFocus
            disabled={isEditing}
            helperText={isEditing ? t('users.usernameCannotChange') : undefined}
          />

          {!isEditing && (
            <TextField
              label={t('users.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              required
            />
          )}

          <FormControl fullWidth>
            <InputLabel>{t('users.role')}</InputLabel>
            <Select
              value={role}
              label={t('users.role')}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              {ROLES.map((r) => (
                <MenuItem key={r} value={r}>
                  {t(`users.roles.${r}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel>{t('users.groups')}</InputLabel>
            <Select
              multiple
              value={selectedGroupIds}
              onChange={handleGroupChange}
              input={<OutlinedInput label={t('users.groups')} />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.map((id) => {
                    const group = groups.find((g) => g.id === id);
                    return <Chip key={id} label={group?.name || id} size="small" />;
                  })}
                </Box>
              )}
            >
              {groups.map((group) => (
                <MenuItem key={group.id} value={group.id}>
                  {group.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSaving}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={isSaving}>
          {isSaving ? <CircularProgress size={24} /> : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
