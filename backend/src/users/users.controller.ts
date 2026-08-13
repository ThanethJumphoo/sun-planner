import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async getAll() {
    try {
      const data = await this.usersService.findAll();
      return { success: true, data };
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post()
  async create(@Body() body: any) {
    try {
      const data = await this.usersService.create(body);
      return { success: true, data };
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    try {
      const data = await this.usersService.update(id, body);
      if (!data) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }
      return { success: true, data };
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    try {
      const success = await this.usersService.delete(id);
      if (!success) {
        throw new HttpException(
          'User not found or delete failed',
          HttpStatus.NOT_FOUND,
        );
      }
      return { success, message: 'User deleted successfully' };
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
