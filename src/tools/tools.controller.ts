import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { ToolsService } from './tools.service';
import { SalaryCalculatorDto } from './dto/salary-calculator.dto';
import { Public, ResponseMessage } from 'src/decorators/customize';

@ApiTags('tools')
@Controller('tools')
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Public()
  @ResponseMessage('Tính lương thành công')
  @ApiBody({ type: SalaryCalculatorDto })
  @Post('salary-calculator')
  salaryCalculator(@Body() dto: SalaryCalculatorDto) {
    return this.toolsService.calculate(dto);
  }
}
