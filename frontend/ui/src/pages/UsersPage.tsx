import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Container,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  CircularProgress,
  Alert,
  Chip,
  Tabs,
  Tab,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { Add, Edit, Delete } from '@mui/icons-material';
import { apiClient, type User, type Group } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, useApiQuery } from '../hooks/useApiQuery';
import { UserDialog } from '../components/UserDialog';
import { useAuth } from '../context/AuthContext';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const usersQuery = useApiQuery(queryKeys.users, () => apiClient.getUsers());
  const groupsQuery = useApiQuery(queryKeys.groups, () => apiClient.getGroups());
  const users: User[] = usersQuery.data?.users ?? [];
  const groups: Group[] = groupsQuery.data?.groups ?? [];
  const isLoading = usersQuery.isPending || groupsQuery.isPending;

  // Errors from a delete are shown in the same alert as a failed load, and
  // can be dismissed.
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadErrorDismissed, setLoadErrorDismissed] = useState(false);
  const loadError = usersQuery.errorMessage ?? groupsQuery.errorMessage;
  const error = actionError ?? (loadErrorDismissed ? null : loadError);
  const setError = (message: string | null) => {
    setActionError(message);
    if (message === null) setLoadErrorDismissed(true);
  };
  const [tabValue, setTabValue] = useState(0);

  // User dialog state
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Group dialog state
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [groupName, setGroupName] = useState('');
  const [isGroupSaving, setIsGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  /** Re-read both lists after a dialog saved something. */
  const loadData = useCallback(async () => {
    await Promise.all([usersQuery.refetch(), groupsQuery.refetch()]);
  }, [usersQuery, groupsQuery]);

  // User handlers
  const handleCreateUser = () => {
    setEditingUser(null);
    setUserDialogOpen(true);
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setUserDialogOpen(true);
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm(t('users.confirmDelete'))) {
      return;
    }

    const result = await apiClient.deleteUser(id);
    if (result.error) {
      setError(result.error);
    } else {
      queryClient.setQueryData<{ users: User[] }>(queryKeys.users, (prev) =>
        prev ? { users: prev.users.filter((u) => u.id !== id) } : prev
      );
    }
  };

  const handleUserDialogClose = () => {
    setUserDialogOpen(false);
    setEditingUser(null);
  };

  const handleUserDialogSave = async () => {
    handleUserDialogClose();
    await loadData();
  };

  // Group handlers
  const handleCreateGroup = () => {
    setEditingGroup(null);
    setGroupName('');
    setGroupError(null);
    setGroupDialogOpen(true);
  };

  const handleEditGroup = (group: Group) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setGroupError(null);
    setGroupDialogOpen(true);
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm(t('users.confirmDeleteGroup'))) {
      return;
    }

    const result = await apiClient.deleteGroup(id);
    if (result.error) {
      setError(result.error);
    } else {
      queryClient.setQueryData<{ groups: Group[] }>(queryKeys.groups, (prev) =>
        prev ? { groups: prev.groups.filter((g) => g.id !== id) } : prev
      );
    }
  };

  const handleGroupDialogClose = () => {
    setGroupDialogOpen(false);
    setEditingGroup(null);
    setGroupName('');
    setGroupError(null);
  };

  const handleGroupDialogSave = async () => {
    if (!groupName.trim()) {
      setGroupError(t('users.validation.groupNameRequired'));
      return;
    }

    setIsGroupSaving(true);
    setGroupError(null);

    const result = editingGroup
      ? await apiClient.updateGroup(editingGroup.id, { name: groupName.trim() })
      : await apiClient.createGroup({ name: groupName.trim() });

    setIsGroupSaving(false);

    if (result.error) {
      setGroupError(result.error);
    } else {
      handleGroupDialogClose();
      await loadData();
    }
  };

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '50vh',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        {t('users.title')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label={t('users.usersTab')} />
          <Tab label={t('users.groupsTab')} />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button variant="contained" startIcon={<Add />} onClick={handleCreateUser}>
            {t('users.createUser')}
          </Button>
        </Box>

        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('users.username')}</TableCell>
                <TableCell>{t('users.role')}</TableCell>
                <TableCell>{t('users.groups')}</TableCell>
                <TableCell>{t('users.created')}</TableCell>
                <TableCell align="right">{t('users.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    {t('users.noUsers')}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.name}</TableCell>
                    <TableCell>
                      <Chip
                        label={t(`users.roles.${user.role}`)}
                        size="small"
                        color={user.role === 'Admin' ? 'primary' : user.role === 'Editor' ? 'secondary' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      {user.groups.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          {t('users.noGroupsAssigned')}
                        </Typography>
                      ) : (
                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                          {user.groups.map((group) => (
                            <Chip key={group.id} label={group.name} size="small" variant="outlined" />
                          ))}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton onClick={() => handleEditUser(user)} size="small">
                        <Edit />
                      </IconButton>
                      <IconButton
                        onClick={() => handleDeleteUser(user.id)}
                        size="small"
                        color="error"
                        disabled={user.id === currentUser?.id}
                      >
                        <Delete />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button variant="contained" startIcon={<Add />} onClick={handleCreateGroup}>
            {t('users.createGroup')}
          </Button>
        </Box>

        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('users.groupName')}</TableCell>
                <TableCell>{t('users.userCount')}</TableCell>
                <TableCell>{t('users.libraryCount')}</TableCell>
                <TableCell align="right">{t('users.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    {t('users.noGroups')}
                  </TableCell>
                </TableRow>
              ) : (
                groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell>{group.name}</TableCell>
                    <TableCell>{group._count?.users ?? 0}</TableCell>
                    <TableCell>{group._count?.libraries ?? 0}</TableCell>
                    <TableCell align="right">
                      <IconButton onClick={() => handleEditGroup(group)} size="small">
                        <Edit />
                      </IconButton>
                      <IconButton
                        onClick={() => handleDeleteGroup(group.id)}
                        size="small"
                        color="error"
                      >
                        <Delete />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </TabPanel>

      <UserDialog
        open={userDialogOpen}
        user={editingUser}
        groups={groups}
        onClose={handleUserDialogClose}
        onSave={handleUserDialogSave}
      />

      <Dialog open={groupDialogOpen} onClose={handleGroupDialogClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingGroup ? t('users.editGroup') : t('users.createGroup')}
        </DialogTitle>
        <DialogContent>
          {groupError && (
            <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
              {groupError}
            </Alert>
          )}
          <TextField
            label={t('users.groupName')}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            fullWidth
            required
            autoFocus
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleGroupDialogClose} disabled={isGroupSaving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleGroupDialogSave} variant="contained" disabled={isGroupSaving}>
            {isGroupSaving ? <CircularProgress size={24} /> : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
