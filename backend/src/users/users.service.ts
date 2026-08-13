import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async onModuleInit() {
    // Seed default admin user if none exists
    const adminExists = await this.usersRepository.findOne({
      where: { username: 'admin' },
    });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('password123', 10);
      const admin = this.usersRepository.create({
        username: 'admin',
        passwordHash: hashedPassword,
        role: 'admin',
      });
      await this.usersRepository.save(admin);
      console.log('✅ Default admin user created (admin / password123)');
    }
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { username } });
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({
      select: [
        'id',
        'username',
        'role',
        'department',
        'isActive',
        'createdAt',
        'updatedAt',
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async create(dto: {
    username: string;
    password?: string;
    role: string;
    department?: string;
    isActive?: boolean;
  }): Promise<User> {
    const existing = await this.usersRepository.findOne({
      where: { username: dto.username },
    });
    if (existing) {
      throw new Error('Username already exists');
    }
    const password = dto.password || 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = this.usersRepository.create({
      username: dto.username,
      passwordHash: hashedPassword,
      role: dto.role,
      department: dto.department,
      isActive: dto.isActive !== undefined ? dto.isActive : true,
    });
    return this.usersRepository.save(user);
  }

  async update(
    id: string,
    dto: {
      username?: string;
      password?: string;
      role?: string;
      department?: string;
      isActive?: boolean;
    },
  ): Promise<User | null> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) return null;

    if (dto.username && dto.username !== user.username) {
      const existing = await this.usersRepository.findOne({
        where: { username: dto.username },
      });
      if (existing) {
        throw new Error('Username already exists');
      }
      user.username = dto.username;
    }

    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    if (dto.role) {
      user.role = dto.role;
    }

    if (dto.department !== undefined) {
      user.department = dto.department;
    }

    if (dto.isActive !== undefined) {
      user.isActive = dto.isActive;
    }

    return this.usersRepository.save(user);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.usersRepository.delete(id);
    return typeof result.affected === 'number' && result.affected > 0;
  }
}
