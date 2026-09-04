import { SettingsService } from '../settingsService';
import { prisma, resetDatabase } from '../../test/db';

const settingsService = new SettingsService();

beforeEach(resetDatabase);

describe('SettingsService', () => {
  it('has nothing to report before anything is saved', async () => {
    expect(await settingsService.getSettings()).toBeNull();
  });

  it('creates the singleton row on first ask, and reuses it after', async () => {
    const created = await settingsService.getOrCreateSettings('Wilkie Media');
    const again = await settingsService.getOrCreateSettings('Something Else');

    expect(created.instanceName).toBe('Wilkie Media');
    expect(again.id).toBe(created.id);
    expect(again.instanceName).toBe('Wilkie Media');
    expect(await prisma.settings.count()).toBe(1);
  });

  it('names the instance even when there is no row yet', async () => {
    const settings = await settingsService.updateInstanceName('Tubeca at home');

    expect(settings.instanceName).toBe('Tubeca at home');
    expect(await prisma.settings.count()).toBe(1);
  });

  it('renames the row that is already there rather than adding another', async () => {
    const created = await settingsService.getOrCreateSettings();

    const renamed = await settingsService.updateInstanceName('Renamed');

    expect(renamed.id).toBe(created.id);
    expect(await prisma.settings.count()).toBe(1);
  });

  it('calls a nameless instance Tubeca Instance', async () => {
    expect((await settingsService.getOrCreateSettings()).instanceName).toBe('Tubeca Instance');
  });
});
