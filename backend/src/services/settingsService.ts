import { prisma } from '../config/database'
import { Settings } from '@prisma/client'

export class SettingsService {
  // Get the settings (singleton)
  async getSettings(): Promise<Settings | null> {
    const settings = await prisma.settings.findFirst()
    return settings
  }

  // Get or create settings with default values
  async getOrCreateSettings(defaultInstanceName: string = 'Tubeca Instance'): Promise<Settings> {
    let settings = await this.getSettings()

    if (!settings) {
      settings = await prisma.settings.create({
        data: {
          instanceName: defaultInstanceName,
        },
      })
    }

    return settings
  }

  // Update instance name
  async updateInstanceName(instanceName: string): Promise<Settings> {
    const settings = await this.getSettings()

    if (!settings) {
      return await prisma.settings.create({
        data: { instanceName },
      })
    }

    return await prisma.settings.update({
      where: { id: settings.id },
      data: { instanceName },
    })
  }

  // Update settings (generic)
  async updateSettings(data: Partial<Omit<Settings, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Settings> {
    const settings = await this.getSettings()

    if (!settings) {
      return await prisma.settings.create({
        data: data as { instanceName: string },
      })
    }

    return await prisma.settings.update({
      where: { id: settings.id },
      data,
    })
  }

  // Delete all settings (use with caution)
  async resetSettings(): Promise<void> {
    await prisma.settings.deleteMany({})
  }
}
