import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FilesReadService } from './files-read.service';
import { FilesWriteService } from './files-write.service';
import { MultipartInterceptor } from './multipart.interceptor';
import {
  documentUpdate,
  listQuery,
  replacementInput,
  statusInput,
  uploadInput,
  uuid,
} from './files.validation';

const admins = [UserRole.ADMIN, UserRole.SUPER_ADMIN];
const all = [...admins, UserRole.EMPLOYEE];
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class FilesController {
  constructor(
    private readonly read: FilesReadService,
    private readonly write: FilesWriteService,
  ) {}
  @Post('timesheets')
  @Roles(...all)
  @UseInterceptors(MultipartInterceptor)
  uploadTimesheets(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.write.upload(
      uploadInput(body, req.user!, true),
      req.user!,
      req.files as Express.Multer.File[],
      true,
    );
  }
  @Get('timesheets')
  @Roles(...admins)
  timesheets(@Query() query: Record<string, unknown>) {
    return this.read.list(listQuery(query, true), true);
  }
  @Get('timesheets/:id')
  @Roles(...all)
  timesheet(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.read.detail(uuid(id), req.user!, true);
  }
  @Get('timesheets/:id/file')
  @Roles(...all)
  @Header('Cache-Control', 'no-store')
  timesheetFile(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.read.download(uuid(id), req.user!, true);
  }
  @Patch('timesheets/:id/status')
  @Roles(...admins)
  status(@Param('id') id: string, @Body() body: unknown) {
    return this.write.changeStatus(uuid(id), statusInput(body));
  }
  @Put('timesheets/:id/file')
  @Roles(...admins)
  @UseInterceptors(MultipartInterceptor)
  replace(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.write.replace(
      uuid(id),
      replacementInput(body),
      req.user!,
      req.files as Express.Multer.File[],
    );
  }
  @Post('documents')
  @Roles(...all)
  @UseInterceptors(MultipartInterceptor)
  uploadDocuments(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.write.upload(
      uploadInput(body, req.user!, false),
      req.user!,
      req.files as Express.Multer.File[],
      false,
    );
  }
  @Get('documents')
  @Roles(...admins)
  documents(@Query() query: Record<string, unknown>) {
    return this.read.list(listQuery(query, false), false);
  }
  @Get('documents/:id')
  @Roles(...all)
  document(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.read.detail(uuid(id), req.user!, false);
  }
  @Get('documents/:id/file')
  @Roles(...all)
  @Header('Cache-Control', 'no-store')
  documentFile(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.read.download(uuid(id), req.user!, false);
  }
  @Patch('documents/:id')
  @Roles(...admins)
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.write.updateDocument(uuid(id), documentUpdate(body));
  }
  @Delete('documents/:id')
  @Roles(...admins)
  @HttpCode(204)
  delete(@Param('id') id: string) {
    return this.write.deleteDocument(uuid(id));
  }
}
